const express = require('express');
const cors = require('cors');
const ytDlp = require('yt-dlp-exec');
const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('All-In-One Media Downloader API is Running!');
});

app.post('/api/download', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        // Fast metadata & format extraction with robust user-agent headers
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
            like_count: output.like_count ? output.like_count.toLocaleString() : 'N/A',
            videoUrl: '',
            audioUrl: '',
            formats: []
        };

        // Find best video stream with audio or separate
        let bestVideo = output.formats?.reverse().find(f => f.url && f.vcodec !== 'none' && f.acodec !== 'none');
        if (!bestVideo) {
            bestVideo = output.formats?.find(f => f.url && f.vcodec !== 'none');
        }

        responseData.videoUrl = bestVideo ? bestVideo.url : (output.url || '');
        
        // Audio stream filter
        const bestAudio = output.formats?.find(f => f.url && f.vcodec === 'none' && f.acodec !== 'none');
        responseData.audioUrl = bestAudio ? bestAudio.url : '';

        // All available qualities list
        if (output.formats) {
            responseData.formats = output.formats
                .filter(f => f.url && f.vcodec !== 'none')
                .map(f => ({
                    quality: f.format_note || f.resolution || (f.height ? `${f.height}p` : 'HD Quality'),
                    ext: f.ext || 'mp4',
                    url: f.url
                }));
        }

        return res.json(responseData);

    } catch (error) {
        console.error('Extraction Error:', error.message);
        return res.status(500).json({ 
            error: 'Failed to extract. Ensure the link is public and from a supported platform.' 
        });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
