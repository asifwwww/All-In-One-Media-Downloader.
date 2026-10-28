const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const app = express();

app.use(cors());
app.use(express.json());

app.post('/api/download', (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    // Command to get all video/image formats & direct stream URLs without downloading to server storage
    const command = `yt-dlp --dump-json "${url}"`;

    exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error: ${error.message}`);
            return res.status(500).json({ error: 'Failed to extract media. Make sure URL is public.' });
        }

        try {
            const data = JSON.parse(stdout);
            
            // Format response for UI
            const responseData = {
                title: data.title || 'Downloaded Media',
                thumbnail: data.thumbnail || '',
                duration: data.duration_string || '',
                formats: []
            };

            if (data.formats) {
                // Get available video/audio qualities
                responseData.formats = data.formats
                    .filter(f => f.url && (f.ext === 'mp4' || f.ext === 'm4a' || f.vcodec !== 'none'))
                    .map(f => ({
                        quality: f.format_note || f.resolution || 'Standard Quality',
                        ext: f.ext,
                        url: f.url
                    })).reverse();
            } else if (data.url) {
                // Single image or video direct link
                responseData.formats.push({
                    quality: 'Direct Link / Original',
                    ext: data.ext || 'jpg',
                    url: data.url
                });
            }

            return res.json(responseData);
        } catch (e) {
            return res.status(500).json({ error: 'Parsing error on backend' });
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
