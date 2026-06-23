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

    // ---- ROUTES WILL GO HERE ----

    // POST /api/products — create a new product listing
    // status is always forced to "pending" — sellers can't self-approve their own listings
    app.post('/api/products', async (req, res) => {
      try {
        const {
          title,
          category,
          condition,
          price,
          stock,
          description,
          image,
          sellerId,
          sellerName,
          sellerEmail,
        } = req.body

        // Required-field check
        if (!title || !category || !condition || !price || !stock || !description || !image || !sellerId) {
          return res.status(400).json({ message: 'Missing required fields' })
        }

        const product = {
          title,
          category,
          condition,
          price: Number(price),
          stock: Number(stock),
          description,
          image, // imgbb hosted URL
          sellerId,
          sellerName,
          sellerEmail,
          status: 'pending', // always pending on creation — admin approves separately
          createdAt: new Date(),
        }

        const result = await productCollection.insertOne(product)

        res.status(201).json({ ...product, _id: result.insertedId })
      } catch (err) {
        console.error('Error creating product:', err)
        res.status(500).json({ message: 'Failed to create product' })
      }
    })

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