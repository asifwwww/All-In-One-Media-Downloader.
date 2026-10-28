const express = require('express');
const cors = require('cors');
const ytDlp = require('yt-dlp-exec');
const axios = require('axios');
const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('All-In-One Media Downloader API is Running Perfectly!');
});

// 1. Metadata Fetch Endpoint
app.post('/api/download', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        const output = await ytDlp(url, {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
            addHeader: [
                'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            ]
        });

        const responseData = {
            title: output.title || output.description || 'Downloaded Media',
            thumbnail: output.thumbnail || (output.thumbnails ? output.thumbnails[0]?.url : ''),
            duration: output.duration_string || `${output.duration || 0} sec`,
            uploader: output.uploader || output.channel || 'Unknown Creator',
            view_count: output.view_count ? output.view_count.toLocaleString() : 'N/A',
            videoUrl: '',
            audioUrl: ''
        };

        // Best video format selection
        let bestVideo = output.formats?.reverse().find(f => f.url && f.vcodec !== 'none' && f.acodec !== 'none');
        if (!bestVideo) {
            bestVideo = output.formats?.find(f => f.url && f.vcodec !== 'none');
        }

        const rawVideoUrl = bestVideo ? bestVideo.url : (output.url || '');
        const rawAudioUrl = output.formats?.find(f => f.url && f.vcodec === 'none' && f.acodec !== 'none')?.url || '';

        // Route URLs through our backend proxy to bypass 403 Forbidden errors
        const host = req.headers['host'];
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const serverBase = `${protocol}://${host}`;

        responseData.videoUrl = rawVideoUrl ? `${serverBase}/api/stream?url=${encodeURIComponent(rawVideoUrl)}` : '';
        responseData.audioUrl = rawAudioUrl ? `${serverBase}/api/stream?url=${encodeURIComponent(rawAudioUrl)}` : '';

        return res.json(responseData);

    } catch (error) {
        console.error('Extraction Error:', error.message);
        return res.status(500).json({ 
            error: 'Failed to extract. Ensure the link is public and from a supported platform.' 
        });
    }
});

// 2. Secure Stream / Proxy Endpoint to Bypass 403 Forbidden
app.get('/api/stream', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).send('Target URL missing');
    }

    try {
        const response = await axios({
            method: 'get',
            url: targetUrl,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Range': req.headers.range || 'bytes=0-'
            }
        });

        res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }
        if (response.headers['content-range']) {
            res.setHeader('Content-Range', response.headers['content-range']);
            res.status(206);
        }
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Disposition', 'attachment; filename="downloaded-media.mp4"');

        response.data.pipe(res);
    } catch (err) {
        console.error('Streaming Error:', err.message);
        res.status(500).send('Failed to download media stream.');
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
