const express = require('express');
const { create, decryptMedia } = require('@wppconnect-team/wppconnect');

const app = express();
app.use(express.json());

let client = null;
let qrCodeBase64 = null;
let connectionStatus = 'Desconectado';
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'URL_DO_SEU_WEBHOOK_NO_N8N';

async function initializeClient() {
    try {
        connectionStatus = 'Iniciando...';
        console.log('Tentando iniciar o cliente WhatsApp...');
        client = await create({
            session: 'irds-session',
            catchQR: (base64Qr) => {
                console.log('QR Code capturado!');
                qrCodeBase64 = base64Qr;
                connectionStatus = 'QR Gerado';
            },
            statusFind: (statusSession) => {
                console.log(`Status: ${statusSession}`);
                if (statusSession === 'inChat') {
                    connectionStatus = 'Conectado';
                    qrCodeBase64 = null;
                    console.log('WhatsApp conectado!');
                }
            },
            logQR: false,
            headless: true,
            browserArgs: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        startMessageListener();
    } catch (error) {
        console.error('Erro ao inicializar:', error);
        connectionStatus = `Erro: ${error.message}`;
    }
}

function startMessageListener() {
    client.onMessage(async (message) => {
        if (message.isGroupMsg) return;
        console.log(`Msg de ${message.from}: ${message.body}`);

        const data = { from: message.from, type: message.type, body: message.body };
        if (message.type === 'ptt' || message.type === 'audio') {
            try {
                const buffer = await decryptMedia(message);
                data.audioBase64 = buffer.toString('base64');
            } catch (e) { console.error("Erro ao descriptografar áudio:", e); return; }
        }

        fetch(N8N_WEBHOOK_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        }).catch(err => console.error('Erro ao enviar para n8n:', err.message));
    });
}

// --- ROTAS ---
app.get('/qr', (req, res) => {
    if (connectionStatus === 'Conectado') return res.send('<h1>✅ Conectado!</h1>');
    if (connectionStatus === 'QR Gerado' && qrCodeBase64) {
        return res.send(`<h1>Escaneie o QR Code</h1><img src="data:image/png;base64,${qrCodeBase64}" style="width:300px;height:300px;"/><script>setTimeout(() => window.location.reload(), 30000);</script>`);
    }
    res.send(`<h1>🔄 Status: ${connectionStatus}</h1><p>Aguarde...<script>setTimeout(() => window.location.reload(), 5000);</script>`);
});

app.get('/status', (req, res) => {
    res.json({ status: connectionStatus, hasClient: !!client, hasQrCode: !!qrCodeBase64 });
});

app.post('/send', async (req, res) => {
    if (!client || connectionStatus !== 'Conectado') return res.status(500).send('Cliente não está conectado.');
    const { to, message, isAudio } = req.body;
    try {
        if (isAudio) {
            const audioBuffer = Buffer.from(message, 'base64');
            await client.sendAudio(to, audioBuffer, 'response.mp3');
        } else {
            await client.sendText(to, message);
        }
        res.status(200).send('Enviado!');
    } catch (e) { console.error('Erro ao enviar msg:', e); res.status(500).send('Erro ao enviar.'); }
});

initializeClient();
module.exports = app;
