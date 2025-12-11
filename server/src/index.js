import express from 'express';
import dotenv from 'dotenv';

dotenv.config();
const app = express();

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.listen(process.env.PORT || 3005, () => {
  console.log(`Server is running on port https://localhost:${process.env.PORT || 3005}`);
});