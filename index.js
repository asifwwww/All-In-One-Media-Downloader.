const express = require('express');
const cors = require('cors');
const ytDlp = require('yt-dlp-exec');
const app = express();

app.use(cors());
app.use(express.json());

// Home Check
app.get('/', (req, res) => {
    res.send('Media Downloader API is Running Successfully!');
});

app.post('/api/download', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        // Direct yt-dlp exec execution
        const output = await ytDlp(url, {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
            addHeader: [
                'referer:youtube.com',
                'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            ]
        });

        const responseData = {
            title: output.title || output.description || 'Downloaded Media',
            thumbnail: output.thumbnail || (output.thumbnails ? output.thumbnails[0]?.url : ''),
            duration: output.duration_string || '',
            formats: []
        };

        if (output.formats && output.formats.length > 0) {
            responseData.formats = output.formats
                .filter(f => f.url && (f.ext === 'mp4' || f.ext === 'm4a' || f.vcodec !== 'none' || f.acodec !== 'none'))
                .map(f => ({
                    quality: f.format_note || f.resolution || (f.height ? `${f.height}p` : 'Standard Quality'),
                    ext: f.ext || 'mp4',
                    url: f.url
                })).reverse();
        } 
        
        // Agar single direct image/video url ho (Instagram/TikTok/Pinterest etc)
        if (responseData.formats.length === 0 && output.url) {
            responseData.formats.push({
                quality: 'Original / HD',
                ext: output.ext || 'mp4',
                url: output.url
            });
        }

        return res.json(responseData);

    } catch (error) {
        console.error('Extraction Error:', error);
        return res.status(500).json({ 
            error: 'Failed to extract media. Link private ho sakta hai ya platform anti-bot block kar raha hai.' 
        });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
