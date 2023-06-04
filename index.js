const express = require("express");
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(`${process.env.STRIPE_KEY}`);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();

app.use(cors());
app.use(express.json());

const port = process.env.port || 4000;

const uri = `mongodb+srv://${process.env.USER_ID}:${process.env.USER_KEY}@cluster0.d2cwisz.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const jwtVerify = (req, res, next) => {
  const authorization = req.headers.authorization;

  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "unauthorized access" });
  }

  const token = authorization.split(" ")[1];

  jwt.verify(token, process.env.USER_TOKEN, (error, decoded) => {
    if (error) {
      return res
        .status(401)
        .send({ error: true, message: "unauthorized access" });
    }
    req.decoded = decoded;
    next();
  });
};

async function run() {
  try {
    await client.connect();

    const menuCollection = client.db("restaurants").collection("menu");
    const reviewCollection = client.db("restaurants").collection("reviews");
    const cartCollection = client.db("restaurants").collection("carts");
    const userCollection = client.db("restaurants").collection("users");
    const paymentCollection = client.db("restaurants").collection("payments");

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);

      if (!user?.admin) {
        return res
          .status(403)
          .send({ error: true, message: "forbidden access" });
      }
      next();
    };

    app.post("/jwt", (req, res) => {
      const user = req.body;
      const result = jwt.sign(user, process.env.USER_TOKEN, {
        expiresIn: "24h",
      });

      res.send(result);
    });

    app.get("/users/admin/:email", jwtVerify, async (req, res) => {
      const email = req.params.email;
      const decodedEmail = req.decoded.email;

      if (email !== decodedEmail) {
        return res
          .status(401)
          .send({ error: true, message: "unauthorized access" });
      }

      const filter = { email: email };
      const user = await userCollection.findOne(filter);
      const result = { admin: user?.admin };

      res.send(result);
    });

    app.patch("/users/admin/:id", async (req, res) => {
      const userId = req.params.id;
      const user = req.body;

      const filter = { _id: new ObjectId(userId) };

      const updatedUser = {
        $set: {
          admin: user.admin,
        },
      };

      const result = await userCollection.updateOne(filter, updatedUser);
      res.send(result);
    });

    app.get("/users", jwtVerify, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.delete("/users/:id", async (req, res) => {
      const userId = req.params.id;

      const filter = { _id: new ObjectId(userId) };
      const result = await userCollection.deleteOne(filter);
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;

      const query = { email: user.email };

      const findUser = await userCollection.findOne(query);
      if (findUser) {
        return res.send({ userExist: true });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.get("/menu", async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    });

    app.get("/menu/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await menuCollection.findOne(filter);
      res.send(result);
    });

    app.delete("/menu/:id", jwtVerify, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await menuCollection.deleteOne(filter);
      res.send(result);
    });

    app.post("/menu/:id", jwtVerify, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const item = req.body;
      const filter = { _id: new ObjectId(id) };

      const updatedItem = {
        $set: {
          name: item.name,
          price: item.price,
          recipe: item.recipe,
          category: item.category,
          image: item.image,
        },
      };
      const result = await menuCollection.updateOne(filter, updatedItem, {
        upsert: true,
      });

      res.send(result);
    });

    app.post("/menu", jwtVerify, verifyAdmin, async (req, res) => {
      const recipe = req.body;
      const result = await menuCollection.insertOne(recipe);
      res.send(result);
    });

    app.get("/reviews", async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    });

    app.post("/carts", async (req, res) => {
      const item = req.body;
      const result = await cartCollection.insertOne(item);
      res.send(result);
    });

    app.get("/carts", jwtVerify, async (req, res) => {
      const email = req.query.email;

      if (!email) {
        res.send([]);
      }

      const decodedEmail = req.decoded.email;

      if (email !== decodedEmail) {
        return res
          .status(401)
          .send({ error: true, message: "forbidden access" });
      }

      const query = { email: email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    app.delete("/carts", async (req, res) => {
      const id = req.query.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });

    // create payment intent
    app.post("/create-payment-intent", jwtVerify, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const result = await paymentCollection.insertOne(payment);

      const filter = {
        _id: { $in: payment.cartItems.map((id) => new ObjectId(id)) },
      };

      const clearCart = await cartCollection.deleteMany(filter);

      res.send({ result, clearCart });
    });

    app.get("/payments", jwtVerify, async (req, res) => {
      const result = await paymentCollection.find().toArray();
      res.send(result);
    });

    app.get("/adminstats", jwtVerify, verifyAdmin, async (req, res) => {
      const users = await userCollection.estimatedDocumentCount();
      const products = await menuCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();

      const payments = await paymentCollection.find().toArray();
      const revenue = payments.reduce((total, payment) => {
        return (total += +payment.price);
      }, 0);

      res.send({ users, products, orders, revenue });
    });

    await client.db("admin").command({ ping: 1 });
    console.log("You successfully connected to MongoDB!");
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (_, res) => {
  res.send("Hello World");
});

app.listen(port, () => {
  console.log(`App is running on port ${port}`);
});
