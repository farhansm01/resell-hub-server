const express = require('express')
const cors = require('cors')
require('dotenv').config()

const app = express()
const port = process.env.PORT || 5000

// Middleware
app.use(cors({
  origin: 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))
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

    const userCollection = database.collection('user')
    const productCollection = database.collection('products')
    const orderCollection = database.collection('orders')
    const paymentCollection = database.collection('payments')
    const wishlistCollection = database.collection('wishlist')
    const reviewCollection = database.collection('reviews')


    // ── USERS ────────────────────────────────────────────────────────────

    // GET /api/users/:userEmail — fetch user by email
    app.get('/api/users/:userEmail', async (req, res) => {
      try {
        const { userEmail } = req.params
        const user = await userCollection.findOne({ email: userEmail })
        if (!user) return res.status(404).json({ message: 'User not found' })
        const { password, ...safeUser } = user
        res.status(200).json(safeUser)
      } catch (err) {
        console.error('Error fetching user:', err)
        res.status(500).json({ message: 'Failed to fetch user' })
      }
    })

    // PATCH /api/users/:userEmail — update profile fields by email
    app.patch('/api/users/:userEmail', async (req, res) => {
      try {
        const { userEmail } = req.params
        const { name, phone, location, image } = req.body

        const updateFields = {}
        if (name !== undefined) updateFields.name = name
        if (phone !== undefined) updateFields.phone = phone
        if (location !== undefined) updateFields.location = location
        if (image !== undefined) updateFields.image = image
        updateFields.updatedAt = new Date()

        const result = await userCollection.updateOne(
          { email: userEmail },
          { $set: updateFields }
        )

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: 'User not found' })
        }

        res.status(200).json({ message: 'Profile updated successfully' })
      } catch (err) {
        console.error('Error updating user:', err)
        res.status(500).json({ message: 'Failed to update profile' })
      }
    })


    // ── PRODUCTS ─────────────────────────────────────────────────────────

    // POST /api/products — create new listing (always pending, admin approves)
    app.post('/api/products', async (req, res) => {
      try {
        const { title, category, condition, price, stock, description, image, sellerId, sellerName, sellerEmail } = req.body

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
          image,
          sellerId,
          sellerName,
          sellerEmail,
          status: 'pending',
          createdAt: new Date(),
        }

        const result = await productCollection.insertOne(product)
        res.status(201).json({ ...product, _id: result.insertedId })
      } catch (err) {
        console.error('Error creating product:', err)
        res.status(500).json({ message: 'Failed to create product' })
      }
    })

    // GET /api/products — fetch products with optional filters
    // Public: returns approved products with search/category/sort/pagination
    // Seller dashboard: pass ?sellerId= to get own listings regardless of status
    app.get('/api/products', async (req, res) => {
      try {
        const { sellerId, status, search, category, sort, page = 1, limit = 9 } = req.query

        const query = {}

        if (sellerId) query.sellerId = sellerId

        if (status) {
          query.status = status
        } else if (!sellerId) {
          query.status = 'approved'
        }

        if (search) query.title = { $regex: search, $options: 'i' }
        if (category && category !== 'all') query.category = category

        let sortOption = { createdAt: -1 }
        if (sort === 'price_asc') sortOption = { price: 1 }
        if (sort === 'price_desc') sortOption = { price: -1 }

        const pageNum = parseInt(page)
        const limitNum = parseInt(limit)
        const skip = (pageNum - 1) * limitNum

        const total = await productCollection.countDocuments(query)
        const products = await productCollection
          .find(query)
          .sort(sortOption)
          .skip(skip)
          .limit(limitNum)
          .toArray()

        res.status(200).json({
          products,
          totalPages: Math.ceil(total / limitNum),
          currentPage: pageNum,
        })
      } catch (err) {
        console.error('Error fetching products:', err)
        res.status(500).json({ message: 'Failed to fetch products' })
      }
    })

    // GET /api/products/:id — single product by ObjectId
    app.get('/api/products/:id', async (req, res) => {
      try {
        const { id } = req.params
        const product = await productCollection.findOne({ _id: new ObjectId(id) })
        if (!product) return res.status(404).json({ message: 'Product not found' })
        res.status(200).json(product)
      } catch (err) {
        console.error('Error fetching product:', err)
        res.status(500).json({ message: 'Failed to fetch product' })
      }
    })

    // PUT /api/products/:id — update listing (forces back to pending for re-review)
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
          status: 'pending',
          updatedAt: new Date(),
        }

        const result = await productCollection.updateOne(
          { _id: new ObjectId(id), sellerId },
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

    // DELETE /api/products/:id?sellerId= — seller can only delete own listings
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


    // ── ORDERS ───────────────────────────────────────────────────────────


    // POST /api/orders — create order after successful payment
    app.post('/api/orders', async (req, res) => {
      try {
        const {
          productId, buyerId, buyerName, buyerEmail,
          sellerId, sellerName, sellerEmail, amount,
          stripeSessionId, deliveryInfo, // deliveryInfo added
        } = req.body

        if (!productId || !buyerId || !sellerId || !amount) {
          return res.status(400).json({ message: 'Missing required fields' })
        }

        // prevent duplicate orders on refresh/back button
        if (stripeSessionId) {
          const existing = await orderCollection.findOne({ stripeSessionId })
          if (existing) return res.status(200).json(existing)
        }

        const order = {
          productId,
          buyerId,
          buyerName,
          buyerEmail,
          sellerId,
          sellerName,
          sellerEmail,
          amount: Number(amount),
          // delivery info from checkout form
          deliveryInfo: {
            name: deliveryInfo?.name || '',
            phone: deliveryInfo?.phone || '',
            address: deliveryInfo?.address || '',
          },
          stripeSessionId: stripeSessionId || null,
          orderStatus: 'pending',
          paymentStatus: 'paid',
          createdAt: new Date(),
        }

        const result = await orderCollection.insertOne(order)
        res.status(201).json({ ...order, _id: result.insertedId })
      } catch (err) {
        console.error('Error creating order:', err)
        res.status(500).json({ message: 'Failed to create order' })
      }
    })

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

        if (orders.length === 0) return res.status(200).json([])

        // Enrich with product title and image
        const productIds = orders
          .map(o => { try { return new ObjectId(o.productId) } catch { return null } })
          .filter(Boolean)

        const products = await productCollection
          .find({ _id: { $in: productIds } })
          .toArray()

        const productMap = {}
        products.forEach(p => { productMap[p._id.toString()] = p })

        const enriched = orders.map(order => ({
          ...order,
          productName: productMap[order.productId]?.title || 'Product unavailable',
          productImage: productMap[order.productId]?.image || '',
        }))

        res.status(200).json(enriched)
      } catch (err) {
        console.error('Error fetching buyer orders:', err)
        res.status(500).json({ message: 'Failed to fetch orders' })
      }
    })

    // PATCH /api/orders/:orderId/cancel — buyer cancels own pending order
    app.patch('/api/orders/:orderId/cancel', async (req, res) => {
      try {
        const { orderId } = req.params
        const { buyerId } = req.body

        if (!buyerId) {
          return res.status(400).json({ message: 'buyerId is required' })
        }

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


    // ── WISHLIST ─────────────────────────────────────────────────────────

    // GET /api/wishlist/:userId — buyer's saved products (with product details)
    app.get('/api/wishlist/:userId', async (req, res) => {
      try {
        const { userId } = req.params

        const wishlist = await wishlistCollection
          .find({ userId })
          .sort({ createdAt: -1 })
          .toArray()

        if (wishlist.length === 0) return res.status(200).json([])

        // Fetch product details for each wishlist item
        const productIds = wishlist.map(item => new ObjectId(item.productId))
        const products = await productCollection
          .find({ _id: { $in: productIds } })
          .toArray()

        // Map productId → product for quick lookup
        const productMap = {}
        products.forEach(p => {
          productMap[p._id.toString()] = p
        })

        // Merge wishlist entry with its product fields
        const enriched = wishlist.map(item => {
          const product = productMap[item.productId] || {}
          return {
            _id: item._id,
            userId: item.userId,
            productId: item.productId,
            createdAt: item.createdAt,
            title: product.title || 'Product unavailable',
            image: product.image || '',
            price: product.price ?? 0,
            category: product.category || '',
            status: product.status || '',
          }
        })

        res.status(200).json(enriched)
      } catch (err) {
        console.error('Error fetching wishlist:', err)
        res.status(500).json({ message: 'Failed to fetch wishlist' })
      }
    })

    // POST /api/wishlist — add product to wishlist (duplicate check)
    app.post('/api/wishlist', async (req, res) => {
      try {
        const { userId, productId } = req.body

        if (!userId || !productId) {
          return res.status(400).json({ message: 'userId and productId are required' })
        }

        const existing = await wishlistCollection.findOne({ userId, productId })
        if (existing) {
          return res.status(409).json({ message: 'Already in wishlist' })
        }

        const item = { userId, productId, createdAt: new Date() }
        await wishlistCollection.insertOne(item)

        res.status(201).json({ message: 'Added to wishlist' })
      } catch (err) {
        console.error('Error adding to wishlist:', err)
        res.status(500).json({ message: 'Failed to add to wishlist' })
      }
    })

    // DELETE /api/wishlist/:wishlistId?userId= — remove from wishlist
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


    // ── REVIEWS ──────────────────────────────────────────────────────────

    // GET /api/reviews?productId= — all reviews for a product
    app.get('/api/reviews', async (req, res) => {
      try {
        const { productId } = req.query
        if (!productId) return res.status(400).json({ message: 'productId is required' })

        const reviews = await reviewCollection
          .find({ productId })
          .sort({ createdAt: -1 })
          .toArray()

        res.status(200).json(reviews)
      } catch (err) {
        console.error('Error fetching reviews:', err)
        res.status(500).json({ message: 'Failed to fetch reviews' })
      }
    })

    // POST /api/reviews — submit a review (buyer must have ordered the product, once only)
    app.post('/api/reviews', async (req, res) => {
      try {
        const { productId, buyerId, buyerName, rating, comment } = req.body

        if (!productId || !buyerId || !rating || !comment) {
          return res.status(400).json({ message: 'Missing required fields' })
        }

        // check buyer actually ordered this product
        const order = await orderCollection.findOne({ productId, buyerId })
        if (!order) {
          return res.status(403).json({ message: 'You can only review products you have purchased' })
        }

        // duplicate check
        const existing = await reviewCollection.findOne({ productId, 'reviewerInfo.userId': buyerId })
        if (existing) {
          return res.status(409).json({ message: 'You have already reviewed this product' })
        }

        const review = {
          reviewerInfo: { userId: buyerId, name: buyerName },
          productId,
          rating: Number(rating),
          comment,
          createdAt: new Date(),
        }

        const result = await reviewCollection.insertOne(review)
        res.status(201).json({ ...review, _id: result.insertedId })
      } catch (err) {
        console.error('Error creating review:', err)
        res.status(500).json({ message: 'Failed to submit review' })
      }
    })


    // ── PAYMENTS ─────────────────────────────────────────────────────────

    // GET /api/payments/buyer/:buyerId — buyer's payment history
    app.get('/api/payments/buyer/:buyerId', async (req, res) => {
      try {
        const { buyerId } = req.params

        const payments = await paymentCollection
          .find({ buyerId })
          .sort({ createdAt: -1 })
          .toArray()

        res.status(200).json(payments)
      } catch (err) {
        console.error('Error fetching payments:', err)
        res.status(500).json({ message: 'Failed to fetch payments' })
      }
    })

    // POST /api/payments — save payment record
    // POST /api/payments — record payment after successful checkout
    app.post('/api/payments', async (req, res) => {
      try {
        const { orderId, transactionId, buyerId, amount, paymentDate } = req.body

        if (!orderId || !transactionId || !buyerId || !amount) {
          return res.status(400).json({ message: 'Missing required fields' })
        }

        // dedupe - if this transactionId already has a payment, return it instead of inserting again
        const existing = await paymentCollection.findOne({ transactionId })
        if (existing) return res.status(200).json(existing)

        const payment = {
          orderId,
          transactionId,
          buyerId,
          amount: Number(amount),
          paymentStatus: 'paid',
          paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
          createdAt: new Date(),
        }

        const result = await paymentCollection.insertOne(payment)
        res.status(201).json({ ...payment, _id: result.insertedId })
      } catch (err) {
        console.error('Error creating payment:', err)
        res.status(500).json({ message: 'Failed to create payment' })
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