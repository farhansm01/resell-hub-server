const express = require('express')
const cors = require('cors')
require('dotenv').config()

const app = express()
const port = process.env.PORT || 5000

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ limit: '10mb', extended: true }))

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const { createRemoteJWKSet, jwtVerify } = require('jose-cjs')

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

client.connect(() => {
  console.log('Connecting to MongoDB')
}).catch(console.dir)

const database = client.db('resellhub')

const userCollection = database.collection('user')
const productCollection = database.collection('products')
const orderCollection = database.collection('orders')
const paymentCollection = database.collection('payments')
const wishlistCollection = database.collection('wishlist')
const reviewCollection = database.collection('reviews')


// ── AUTO RECONNECT — handles Vercel cold starts ───────────────────────────
app.use(async (req, res, next) => {
  try {
    if (!client.topology || !client.topology.isConnected()) {
      await client.connect()
      console.log('MongoDB reconnected')
    }
    next()
  } catch (err) {
    console.error('DB reconnect failed:', err)
    res.status(500).json({ message: 'Database connection failed' })
  }
})

// ── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────

const JWKS = createRemoteJWKSet(new URL(process.env.NEXT_PUBLIC_BETTER_AUTH_URL + '/api/auth/jwks'))

async function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader) {
      return res.status(401).json({ message: 'Unauthorized — no token provided' })
    }

    if (authHeader === `Internal ${process.env.INTERNAL_API_SECRET}`) {
      req.user = { role: 'internal' }
      return next()
    }

    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized — no token provided' })
    }

    const token = authHeader.split(' ')[1]
    const { payload } = await jwtVerify(token, JWKS)

    const user = await userCollection.findOne({ _id: new ObjectId(payload.sub) })
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized — user not found' })
    }

    req.user = user
    next()
  } catch (err) {
    console.error('Token error:', err.message)
    return res.status(401).json({ message: 'Unauthorized — invalid or expired token' })
  }
}

function verifyAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Forbidden — admin access only' })
  }
  next()
}

function verifySeller(req, res, next) {
  if (req.user?.role !== 'seller') {
    return res.status(403).json({ message: 'Forbidden — seller access only' })
  }
  next()
}

function verifyBuyer(req, res, next) {
  if (req.user?.role !== 'buyer') {
    return res.status(403).json({ message: 'Forbidden — buyer access only' })
  }
  next()
}

// ── USERS ────────────────────────────────────────────────────────────

app.get('/api/users/top-sellers', async (req, res) => {
  try {
    const topSellers = await productCollection.aggregate([
      { $match: { status: 'approved' } },
      { $group: { _id: '$sellerId', sellerName: { $first: '$sellerName' }, sellerEmail: { $first: '$sellerEmail' }, totalListings: { $sum: 1 } } },
      { $sort: { totalListings: -1 } },
      { $limit: 6 },
    ]).toArray()

    res.status(200).json(topSellers)
  } catch (err) {
    console.error('Error fetching top sellers:', err)
    res.status(500).json({ message: 'Failed to fetch top sellers' })
  }
})

app.get('/api/users/:userEmail', verifyToken, async (req, res) => {
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

app.patch('/api/users/:userEmail', verifyToken, async (req, res) => {
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

app.get('/api/products/categories', async (req, res) => {
  try {
    const categories = await productCollection.aggregate([
      { $match: { status: 'approved' } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray()

    res.status(200).json(categories.map(c => ({ name: c._id, count: c.count })))
  } catch (err) {
    console.error('Error fetching categories:', err)
    res.status(500).json({ message: 'Failed to fetch categories' })
  }
})

app.post('/api/products', verifyToken, verifySeller, async (req, res) => {
  try {
    const { title, category, condition, price, stock, description, image, sellerId, sellerName, sellerEmail } = req.body

    if (!title || !category || !condition || !price || !stock || !description || !image || !sellerId) {
      return res.status(400).json({ message: 'Missing required fields' })
    }

    const product = {
      title, category, condition,
      price: Number(price),
      stock: Number(stock),
      description, image, sellerId, sellerName, sellerEmail,
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

app.get('/api/products', async (req, res) => {
  try {
    const { sellerId, status, search, category, sort, page = 1, limit = 9, minPrice, maxPrice, condition } = req.query

    const query = {}
    if (sellerId) query.sellerId = sellerId
    if (status) { query.status = status } else if (!sellerId) { query.status = 'approved' }
    if (search) query.title = { $regex: search, $options: 'i' }
    if (category && category !== 'all') query.category = category
    if (minPrice || maxPrice) {
      query.price = {}
      if (minPrice) query.price.$gte = Number(minPrice)
      if (maxPrice) query.price.$lte = Number(maxPrice)
    }
    if (condition && condition !== 'all') query.condition = condition

    let sortOption = { createdAt: -1 }
    if (sort === 'price_asc') sortOption = { price: 1 }
    if (sort === 'price_desc') sortOption = { price: -1 }

    const pageNum = parseInt(page)
    const limitNum = parseInt(limit)
    const skip = (pageNum - 1) * limitNum

    const total = await productCollection.countDocuments(query)
    const products = await productCollection.find(query).sort(sortOption).skip(skip).limit(limitNum).toArray()

    res.status(200).json({ products, totalPages: Math.ceil(total / limitNum), currentPage: pageNum })
  } catch (err) {
    console.error('Error fetching products:', err)
    res.status(500).json({ message: 'Failed to fetch products' })
  }
})

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

app.put('/api/products/:id', verifyToken, verifySeller, async (req, res) => {
  try {
    const { id } = req.params
    const { sellerId, title, category, condition, price, stock, description, image } = req.body

    if (!sellerId) return res.status(400).json({ message: 'sellerId is required' })

    const updateDoc = {
      title, category, condition,
      price: Number(price), stock: Number(stock),
      description, image,
      status: 'pending',
      updatedAt: new Date(),
    }

    const result = await productCollection.updateOne({ _id: new ObjectId(id), sellerId }, { $set: updateDoc })
    if (result.matchedCount === 0) return res.status(404).json({ message: 'Product not found or not owned by this seller' })

    res.status(200).json({ _id: id, ...updateDoc })
  } catch (err) {
    console.error('Error updating product:', err)
    res.status(500).json({ message: 'Failed to update product' })
  }
})

app.delete('/api/products/:id', verifyToken, verifySeller, async (req, res) => {
  try {
    const { id } = req.params
    const { sellerId } = req.query

    if (!sellerId) return res.status(400).json({ message: 'sellerId is required' })

    const result = await productCollection.deleteOne({ _id: new ObjectId(id), sellerId })
    if (result.deletedCount === 0) return res.status(404).json({ message: 'Product not found or not owned by this seller' })

    res.status(200).json({ message: 'Product deleted' })
  } catch (err) {
    console.error('Error deleting product:', err)
    res.status(500).json({ message: 'Failed to delete product' })
  }
})

// ── ORDERS ───────────────────────────────────────────────────────────

app.post('/api/orders', verifyToken, async (req, res) => {
  try {
    const {
      productId, productTitle, buyerId, buyerName, buyerEmail,
      sellerId, sellerName, sellerEmail, amount,
      stripeSessionId, deliveryInfo,
    } = req.body

    if (!productId || !buyerId || !sellerId || !amount) {
      return res.status(400).json({ message: 'Missing required fields' })
    }

    if (stripeSessionId) {
      const existing = await orderCollection.findOne({ stripeSessionId })
      if (existing) return res.status(200).json(existing)
    }

    const order = {
      productId,
      productTitle: productTitle || '',
      buyerId, buyerName, buyerEmail,
      sellerId, sellerName, sellerEmail,
      amount: Number(amount),
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

app.get('/api/orders/buyer/:buyerId', verifyToken, async (req, res) => {
  try {
    const { buyerId } = req.params
    const { status } = req.query

    const query = { buyerId }
    if (status) query.orderStatus = status

    const orders = await orderCollection.find(query).sort({ createdAt: -1 }).toArray()
    if (orders.length === 0) return res.status(200).json([])

    const productIds = orders
      .map(o => { try { return new ObjectId(o.productId) } catch { return null } })
      .filter(Boolean)

    const products = await productCollection.find({ _id: { $in: productIds } }).toArray()
    const productMap = {}
    products.forEach(p => { productMap[p._id.toString()] = p })

    const enriched = orders.map(order => ({
      ...order,
      productName: productMap[order.productId]?.title || order.productTitle || 'Product unavailable',
      productImage: productMap[order.productId]?.image || '',
    }))

    res.status(200).json(enriched)
  } catch (err) {
    console.error('Error fetching buyer orders:', err)
    res.status(500).json({ message: 'Failed to fetch orders' })
  }
})

app.get('/api/orders/seller/:sellerId', verifyToken, async (req, res) => {
  try {
    const { sellerId } = req.params
    const { status } = req.query

    const query = { sellerId }
    if (status) query.orderStatus = status

    const orders = await orderCollection.find(query).sort({ createdAt: -1 }).toArray()
    res.status(200).json(orders)
  } catch (err) {
    console.error('Error fetching seller orders:', err)
    res.status(500).json({ message: 'Failed to fetch seller orders' })
  }
})

app.patch('/api/orders/:orderId/cancel', verifyToken, async (req, res) => {
  try {
    const { orderId } = req.params
    const { buyerId } = req.body

    if (!buyerId) return res.status(400).json({ message: 'buyerId is required' })

    const result = await orderCollection.updateOne(
      { _id: new ObjectId(orderId), buyerId, orderStatus: 'pending' },
      { $set: { orderStatus: 'cancelled', updatedAt: new Date() } }
    )

    if (result.matchedCount === 0) return res.status(404).json({ message: 'Order not found, not yours, or no longer pending' })

    res.status(200).json({ message: 'Order cancelled' })
  } catch (err) {
    console.error('Error cancelling order:', err)
    res.status(500).json({ message: 'Failed to cancel order' })
  }
})

app.patch('/api/orders/:orderId/status', verifyToken, verifySeller, async (req, res) => {
  try {
    const { orderId } = req.params
    const { sellerId, orderStatus } = req.body

    if (!sellerId || !orderStatus) return res.status(400).json({ message: 'sellerId and orderStatus are required' })

    const validStatuses = ['accepted', 'processing', 'shipped', 'delivered']
    if (!validStatuses.includes(orderStatus)) return res.status(400).json({ message: 'Invalid order status' })

    const result = await orderCollection.updateOne(
      { _id: new ObjectId(orderId), sellerId },
      { $set: { orderStatus, updatedAt: new Date() } }
    )

    if (result.matchedCount === 0) return res.status(404).json({ message: 'Order not found or not owned by this seller' })

    res.status(200).json({ message: 'Order status updated' })
  } catch (err) {
    console.error('Error updating order status:', err)
    res.status(500).json({ message: 'Failed to update order status' })
  }
})

// ── WISHLIST ─────────────────────────────────────────────────────────

app.get('/api/wishlist/:userId', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params
    const wishlist = await wishlistCollection.find({ userId }).sort({ createdAt: -1 }).toArray()
    if (wishlist.length === 0) return res.status(200).json([])

    const productIds = wishlist.map(item => new ObjectId(item.productId))
    const products = await productCollection.find({ _id: { $in: productIds } }).toArray()
    const productMap = {}
    products.forEach(p => { productMap[p._id.toString()] = p })

    const enriched = wishlist.map(item => {
      const product = productMap[item.productId] || {}
      return {
        _id: item._id, userId: item.userId, productId: item.productId, createdAt: item.createdAt,
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

app.post('/api/wishlist', verifyToken, async (req, res) => {
  try {
    const { userId, productId } = req.body
    if (!userId || !productId) return res.status(400).json({ message: 'userId and productId are required' })

    const existing = await wishlistCollection.findOne({ userId, productId })
    if (existing) return res.status(409).json({ message: 'Already in wishlist' })

    const item = { userId, productId, createdAt: new Date() }
    await wishlistCollection.insertOne(item)
    res.status(201).json({ message: 'Added to wishlist' })
  } catch (err) {
    console.error('Error adding to wishlist:', err)
    res.status(500).json({ message: 'Failed to add to wishlist' })
  }
})

app.delete('/api/wishlist/:wishlistId', verifyToken, async (req, res) => {
  try {
    const { wishlistId } = req.params
    const { userId } = req.query
    if (!userId) return res.status(400).json({ message: 'userId is required' })

    const result = await wishlistCollection.deleteOne({ _id: new ObjectId(wishlistId), userId })
    if (result.deletedCount === 0) return res.status(404).json({ message: 'Wishlist item not found or not owned by this user' })

    res.status(200).json({ message: 'Removed from wishlist' })
  } catch (err) {
    console.error('Error removing wishlist item:', err)
    res.status(500).json({ message: 'Failed to remove from wishlist' })
  }
})

// ── REVIEWS ──────────────────────────────────────────────────────────

app.get('/api/reviews', async (req, res) => {
  try {
    const { productId } = req.query
    if (!productId) return res.status(400).json({ message: 'productId is required' })

    const reviews = await reviewCollection.find({ productId }).sort({ createdAt: -1 }).toArray()
    res.status(200).json(reviews)
  } catch (err) {
    console.error('Error fetching reviews:', err)
    res.status(500).json({ message: 'Failed to fetch reviews' })
  }
})

app.post('/api/reviews', verifyToken, verifyBuyer, async (req, res) => {
  try {
    const { productId, buyerId, buyerName, rating, comment } = req.body
    if (!productId || !buyerId || !rating || !comment) return res.status(400).json({ message: 'Missing required fields' })

    const order = await orderCollection.findOne({ productId, buyerId })
    if (!order) return res.status(403).json({ message: 'You can only review products you have purchased' })



    const review = {
      reviewerInfo: { userId: buyerId, name: buyerName },
      productId, rating: Number(rating), comment,
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

app.get('/api/payments/buyer/:buyerId', verifyToken, async (req, res) => {
  try {
    const { buyerId } = req.params
    const payments = await paymentCollection.find({ buyerId }).sort({ createdAt: -1 }).toArray()
    res.status(200).json(payments)
  } catch (err) {
    console.error('Error fetching payments:', err)
    res.status(500).json({ message: 'Failed to fetch payments' })
  }
})

app.post('/api/payments', verifyToken, async (req, res) => {
  try {
    const { orderId, transactionId, buyerId, amount, paymentDate } = req.body
    if (!orderId || !transactionId || !buyerId || !amount) return res.status(400).json({ message: 'Missing required fields' })

    const existing = await paymentCollection.findOne({ transactionId })
    if (existing) return res.status(200).json(existing)

    const payment = {
      orderId, transactionId, buyerId,
      amount: Number(amount),
      paymentStatus: 'paid',
      paymentMethod: 'stripe',
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

// ── STATS ─────────────────────────────────────────────────────────────

app.get('/api/stats', async (req, res) => {
  try {
    const totalProducts = await productCollection.countDocuments({ status: 'approved' })
    const totalOrders = await orderCollection.countDocuments()
    const totalSellers = await userCollection.countDocuments({ role: 'seller' })
    const totalBuyers = await userCollection.countDocuments({ role: 'buyer' })

    res.status(200).json({ totalProducts, totalOrders, totalSellers, totalBuyers })
  } catch (err) {
    console.error('Error fetching stats:', err)
    res.status(500).json({ message: 'Failed to fetch stats' })
  }
})

// ── ADMIN ─────────────────────────────────────────────────────────────

app.get('/api/admin/stats', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const [totalUsers, totalProducts, totalOrders, payments] = await Promise.all([
      userCollection.countDocuments(),
      productCollection.countDocuments(),
      orderCollection.countDocuments(),
      paymentCollection.find({ paymentStatus: 'paid' }).toArray(),
    ])

    const totalRevenue = payments.reduce((sum, p) => sum + (p.amount || 0), 0)
    res.status(200).json({ totalUsers, totalProducts, totalOrders, totalRevenue })
  } catch (err) {
    console.error('Error fetching admin stats:', err)
    res.status(500).json({ message: 'Failed to fetch stats' })
  }
})

app.get('/api/admin/users', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { role, search } = req.query
    const query = {}
    if (role) query.role = role
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ]
    }

    const users = await userCollection.find(query).sort({ createdAt: -1 }).toArray()
    const safe = users.map(({ password, ...u }) => u)
    res.status(200).json(safe)
  } catch (err) {
    console.error('Error fetching users:', err)
    res.status(500).json({ message: 'Failed to fetch users' })
  }
})

app.patch('/api/admin/users/:userId/status', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { userId } = req.params
    const { status } = req.body

    if (!['active', 'blocked'].includes(status)) return res.status(400).json({ message: 'Invalid status' })

    const result = await userCollection.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { status, updatedAt: new Date() } }
    )

    if (result.matchedCount === 0) return res.status(404).json({ message: 'User not found' })
    res.status(200).json({ message: `User ${status}` })
  } catch (err) {
    console.error('Error updating user status:', err)
    res.status(500).json({ message: 'Failed to update user status' })
  }
})

app.delete('/api/admin/users/:userId', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { userId } = req.params
    const result = await userCollection.deleteOne({ _id: new ObjectId(userId) })
    if (result.deletedCount === 0) return res.status(404).json({ message: 'User not found' })
    res.status(200).json({ message: 'User deleted' })
  } catch (err) {
    console.error('Error deleting user:', err)
    res.status(500).json({ message: 'Failed to delete user' })
  }
})

app.get('/api/admin/products', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { search, category, status } = req.query
    const query = {}
    if (status) query.status = status
    if (search) query.title = { $regex: search, $options: 'i' }
    if (category && category !== 'all') query.category = category

    const products = await productCollection.find(query).sort({ createdAt: -1 }).toArray()
    res.status(200).json(products)
  } catch (err) {
    console.error('Error fetching admin products:', err)
    res.status(500).json({ message: 'Failed to fetch products' })
  }
})

app.patch('/api/admin/products/:productId/status', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { productId } = req.params
    const { status } = req.body

    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ message: 'Invalid status' })

    const result = await productCollection.updateOne(
      { _id: new ObjectId(productId) },
      { $set: { status, updatedAt: new Date() } }
    )

    if (result.matchedCount === 0) return res.status(404).json({ message: 'Product not found' })
    res.status(200).json({ message: `Product ${status}` })
  } catch (err) {
    console.error('Error updating product status:', err)
    res.status(500).json({ message: 'Failed to update product status' })
  }
})

app.delete('/api/admin/products/:productId', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { productId } = req.params
    const result = await productCollection.deleteOne({ _id: new ObjectId(productId) })
    if (result.deletedCount === 0) return res.status(404).json({ message: 'Product not found' })
    res.status(200).json({ message: 'Product deleted' })
  } catch (err) {
    console.error('Error deleting product:', err)
    res.status(500).json({ message: 'Failed to delete product' })
  }
})

app.get('/api/admin/orders', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { status } = req.query
    const query = {}
    if (status) query.orderStatus = status

    const orders = await orderCollection.find(query).sort({ createdAt: -1 }).toArray()
    res.status(200).json(orders)
  } catch (err) {
    console.error('Error fetching admin orders:', err)
    res.status(500).json({ message: 'Failed to fetch orders' })
  }
})

app.patch('/api/admin/orders/:orderId/status', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { orderId } = req.params
    const { orderStatus } = req.body

    const validStatuses = ['pending', 'accepted', 'processing', 'shipped', 'delivered', 'cancelled']
    if (!validStatuses.includes(orderStatus)) return res.status(400).json({ message: 'Invalid order status' })

    const result = await orderCollection.updateOne(
      { _id: new ObjectId(orderId) },
      { $set: { orderStatus, updatedAt: new Date() } }
    )

    if (result.matchedCount === 0) return res.status(404).json({ message: 'Order not found' })
    res.status(200).json({ message: 'Order status updated' })
  } catch (err) {
    console.error('Error updating order status:', err)
    res.status(500).json({ message: 'Failed to update order status' })
  }
})

app.get('/api/admin/payments', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { status, search } = req.query
    const query = {}
    if (status) query.paymentStatus = status
    if (search) query.transactionId = { $regex: search, $options: 'i' }

    const payments = await paymentCollection.find(query).sort({ createdAt: -1 }).toArray()
    res.status(200).json(payments)
  } catch (err) {
    console.error('Error fetching admin payments:', err)
    res.status(500).json({ message: 'Failed to fetch payments' })
  }
})

if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`ReSell Hub server running on port ${port}`)
  })
}

module.exports = app