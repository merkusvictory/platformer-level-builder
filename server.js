require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { processLevelImage } = require('./src/levelConverter');

const app    = express();
const upload = multer({ storage: multer.memoryStorage() });

// Serve game.html and level_output.json as static files
app.use(express.static(path.join(__dirname)));

// POST /upload — accepts an image, runs the Gemini pipeline, returns level JSON
app.post('/upload', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });

  try {
    const level = await processLevelImage(req.file.buffer);
    // Persist to level_output.json so a page reload also gets the latest level
    fs.writeFileSync(path.join(__dirname, 'level_output.json'), JSON.stringify(level, null, 2));
    res.json(level);
  } catch (err) {
    console.error('Conversion error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
