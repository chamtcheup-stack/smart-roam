const express = require('express')
const cors = require('cors')
require('dotenv').config()

const app = express()

app.use(cors())
app.use(express.json())
app.use('/api/users',       require('./src/routes/users'))
app.use('/api/forwarding',  require('./src/routes/forwarding'))
app.use('/api/mirror',      require('./src/routes/mirror'))
app.use('/api/prediction',  require('./src/routes/prediction'))
app.use('/api/stock',       require('./src/routes/stock'))
app.use('/api/esim',       require('./src/routes/esim'))
app.use('/api/geolocalisation',  require('./src/routes/geolocalisation'))
app.use('/api/security',      require('./src/routes/security'))
app.use('/api/currency',  require('./src/routes/currency'))
app.use('/api/declarations',       require('./src/routes/declarations'))

// Route de test
app.get('/', (req, res) => {
  res.json({
    message: 'Serveur Smart Roam opérationnel'
  })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`)
})