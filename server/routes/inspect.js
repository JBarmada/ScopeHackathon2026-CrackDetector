const express = require('express');
const multer = require('multer');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://ml-service:8000';

router.post('/detect', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const formData = new FormData();
    formData.append('file', new Blob([req.file.buffer]), req.file.originalname);

    const confidence = req.query.confidence || '0.25';
    const mlResponse = await fetch(
      `${ML_SERVICE_URL}/predict?confidence=${confidence}`,
      { method: 'POST', body: formData },
    );

    if (!mlResponse.ok) {
      const errText = await mlResponse.text();
      throw new Error(`ML service error: ${mlResponse.status} ${errText}`);
    }

    const result = await mlResponse.json();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
