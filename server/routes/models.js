const express = require('express');
const multer = require('multer');
const { OssClient } = require('@aps_sdk/oss');
const { ModelDerivativeClient, OutputType, View } = require('@aps_sdk/model-derivative');
const { getToken } = require('./auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

const ossClient = new OssClient();
const mdClient = new ModelDerivativeClient();

const BUCKET_KEY = process.env.APS_BUCKET || 'crack-inspector-bucket';

function toBase64Urn(urn) {
  return Buffer.from(urn).toString('base64').replace(/=/g, '');
}

async function ensureBucket(token) {
  try {
    await ossClient.createBucket(
      'US',
      { bucketKey: BUCKET_KEY, policyKey: 'transient' },
      { accessToken: token },
    );
  } catch (err) {
    // 409 = bucket already exists, that's fine
    if (!err.message?.includes('409') && err.statusCode !== 409 && err.axiosError?.response?.status !== 409) {
      throw err;
    }
  }
}

// Upload file and start translation
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const token = await getToken();
    await ensureBucket(token);

    const objectKey = `${Date.now()}-${req.file.originalname}`;

    await ossClient.uploadObject(
      BUCKET_KEY,
      objectKey,
      req.file.buffer,
      { accessToken: token },
    );

    const objectUrn = `urn:adsk.objects:os.object:${BUCKET_KEY}/${objectKey}`;
    const base64Urn = toBase64Urn(objectUrn);

    await mdClient.startJob(
      {
        input: { urn: base64Urn },
        output: {
          formats: [{ type: OutputType.Svf2, views: [View._2d, View._3d] }],
        },
      },
      { accessToken: token },
    );

    res.json({ urn: base64Urn, objectKey, status: 'processing' });
  } catch (err) {
    next(err);
  }
});

// Check translation status
router.get('/:urn/status', async (req, res, next) => {
  try {
    const token = await getToken();
    const manifest = await mdClient.getManifest(
      req.params.urn,
      { accessToken: token },
    );
    res.json({ status: manifest.status, progress: manifest.progress });
  } catch (err) {
    next(err);
  }
});

// List uploaded models
router.get('/', async (req, res, next) => {
  try {
    const token = await getToken();
    const objects = await ossClient.getObjects(
      BUCKET_KEY,
      { accessToken: token },
    );
    const items = (objects.items || []).map((obj) => ({
      name: obj.objectKey,
      urn: toBase64Urn(`urn:adsk.objects:os.object:${BUCKET_KEY}/${obj.objectKey}`),
    }));
    res.json(items);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
