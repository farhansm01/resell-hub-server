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


    // GET /api/products?sellerId=... — list only this seller's products, newest first
    app.get('/api/products', async (req, res) => {
      try {
        const { sellerId } = req.query
        if (!sellerId) {
          return res.status(400).json({ message: 'sellerId is required' })
        }

        const products = await productCollection
          .find({ sellerId })
          .sort({ createdAt: -1 })
          .toArray()

        res.status(200).json(products)
      } catch (err) {
        console.error('Error fetching products:', err)
        res.status(500).json({ message: 'Failed to fetch products' })
      }
    })

    // PUT /api/products/:id — update a listing, forces status back to "pending" for re-review
    app.put('/api/products/:id', async (req, res) => {
      try {
        const { id } = req.params
        const { sellerId, title, category, condition, price, stock, description, image } = req.body

        if (!sellerId) {
          return res.status(400).json({ message: 'sellerId is required' })
        }

        const updateDoc = {
          title,
          category,
          condition,
          price: Number(price),
          stock: Number(stock),
          description,
          image,
          status: 'pending', // edited listings go back through review
          updatedAt: new Date(),
        }

        const result = await productCollection.updateOne(
          { _id: new ObjectId(id), sellerId }, // sellerId check prevents editing someone else's listing
          { $set: updateDoc }
        )

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: 'Product not found or not owned by this seller' })
        }

        res.status(200).json({ _id: id, ...updateDoc })
      } catch (err) {
        console.error('Error updating product:', err)
        res.status(500).json({ message: 'Failed to update product' })
      }
    })

    // DELETE /api/products/:id?sellerId=... — sellerId check prevents deleting someone else's listing
    app.delete('/api/products/:id', async (req, res) => {
      try {
        const { id } = req.params
        const { sellerId } = req.query

        if (!sellerId) {
          return res.status(400).json({ message: 'sellerId is required' })
        }

        const result = await productCollection.deleteOne({
          _id: new ObjectId(id),
          sellerId,
        })

        if (result.deletedCount === 0) {
          return res.status(404).json({ message: 'Product not found or not owned by this seller' })
        }

        res.status(200).json({ message: 'Product deleted' })
      } catch (err) {
        console.error('Error deleting product:', err)
        res.status(500).json({ message: 'Failed to delete product' })
      }
    })



    // orders

    // GET /api/orders/buyer/:buyerId — optional ?status= filter, reused later by the Review page
    app.get('/api/orders/buyer/:buyerId', async (req, res) => {
      try {
        const { buyerId } = req.params
        const { status } = req.query

        const query = { buyerId }
        if (status) query.orderStatus = status

        const orders = await orderCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray()

        res.status(200).json(orders)
      } catch (err) {
        console.error('Error fetching buyer orders:', err)
        res.status(500).json({ message: 'Failed to fetch orders' })
      }
    })

    // PATCH /api/orders/:orderId/cancel — buyer cancels their own pending order
    app.patch('/api/orders/:orderId/cancel', async (req, res) => {
      try {
        const { orderId } = req.params
        const { buyerId } = req.body

        if (!buyerId) {
          return res.status(400).json({ message: 'buyerId is required' })
        }

        // Server-side guard — only the owning buyer can cancel, and only while still pending
        const result = await orderCollection.updateOne(
          { _id: new ObjectId(orderId), buyerId, orderStatus: 'pending' },
          { $set: { orderStatus: 'cancelled', updatedAt: new Date() } }
        )

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: 'Order not found, not yours, or no longer pending' })
        }

        res.status(200).json({ message: 'Order cancelled' })
      } catch (err) {
        console.error('Error cancelling order:', err)
        res.status(500).json({ message: 'Failed to cancel order' })
      }
    })

    // GET /api/wishlist/:userId — this buyer's saved products
    app.get('/api/wishlist/:userId', async (req, res) => {
      try {
        const { userId } = req.params

        const wishlist = await wishlistCollection
          .find({ userId })
          .sort({ createdAt: -1 })
          .toArray()

        res.status(200).json(wishlist)
      } catch (err) {
        console.error('Error fetching wishlist:', err)
        res.status(500).json({ message: 'Failed to fetch wishlist' })
      }
    })

    // DELETE /api/wishlist/:wishlistId?userId=... — userId check prevents removing someone else's item
    app.delete('/api/wishlist/:wishlistId', async (req, res) => {
      try {
        const { wishlistId } = req.params
        const { userId } = req.query

        if (!userId) {
          return res.status(400).json({ message: 'userId is required' })
        }

        const result = await wishlistCollection.deleteOne({
          _id: new ObjectId(wishlistId),
          userId,
        })

        if (result.deletedCount === 0) {
          return res.status(404).json({ message: 'Wishlist item not found or not owned by this user' })
        }

        res.status(200).json({ message: 'Removed from wishlist' })
      } catch (err) {
        console.error('Error removing wishlist item:', err)
        res.status(500).json({ message: 'Failed to remove from wishlist' })
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