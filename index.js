const express = require('express')
const cors = require('cors')
require('dotenv').config()

const app = express()
const port = process.env.PORT || 5000

// Middleware
app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ limit: '10mb', extended: true }))

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')

app.get('/', (req, res) => {
  res.send('ReSell Hub Server Running!')
})

const uri = process.env.MONGODB_URI

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
})

async function run() {
  try {
    await client.connect()

    const database = client.db('resellhub')

    // Collections
    const userCollection = database.collection('users')
    const productCollection = database.collection('products')
    const orderCollection = database.collection('orders')
    const paymentCollection = database.collection('payments')
    const wishlistCollection = database.collection('wishlist')
    const reviewCollection = database.collection('reviews')

    // ---- ROUTES WILL GO HERE ----

    await client.db('admin').command({ ping: 1 })
    console.log('Successfully connected to MongoDB!')

  } finally {
    // await client.close()
  }
}

run().catch(console.dir)

app.listen(port, () => {
  console.log(`ReSell Hub server running on port ${port}`)
})