const express = require('express');
const cors = require('cors');
require('dotenv').config();

const placesRouter = require('./routes/places');
const propertyTaxRouter = require('./routes/property-tax');
const calculateRouter = require('./routes/calculate');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api/places', placesRouter);
app.use('/api/property-tax', propertyTaxRouter);
app.use('/api/calculate', calculateRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Mortgage Expert backend running on port ${PORT}`);
});

module.exports = app;
