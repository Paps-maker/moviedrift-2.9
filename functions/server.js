const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Firebase Admin using environment variable
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
} else {
    admin.initializeApp();
}

const db = admin.firestore();

/* Credentials */
const MPESA_CONSUMER_KEY = "sUwAPhnIQIe8SFCSnwmG3St4QivNOAYXpVD1M8DuC5NGUYdi";
const MPESA_CONSUMER_SECRET = "CXKpFJyyOtKSfRLXCsaLJknrMCyU17CZGhBFrKqOTExk7vBFGfJz57K8CEI3djqh";
const MPESA_PASSKEY = "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919";
const MPESA_SHORTCODE = "174379";
const MPESA_BASE_URL = "https://sandbox.safaricom.co.ke";

// Set automatically on Render or fallback
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || "http://localhost:3000";
const MPESA_CALLBACK_URL = `${RENDER_EXTERNAL_URL}/mpesaCallback`;

/* Helpers */
function timestampNow() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return (
        d.getFullYear().toString() +
        pad(d.getMonth() + 1) +
        pad(d.getDate()) +
        pad(d.getHours()) +
        pad(d.getMinutes()) +
        pad(d.getSeconds())
    );
}

async function getAccessToken() {
    const auth = Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`).toString("base64");
    const res = await fetch(`${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
        headers: { Authorization: `Basic ${auth}` }
    });
    const data = await res.json();
    if (!data.access_token) throw new Error("Could not get M-Pesa access token.");
    return data.access_token;
}

function formatPhone(phone) {
    return phone.replace(/^0/, "254");
}

/* 1) INITIATE STK PUSH */
app.post("/initiateStkPush", async (req, res) => {
    try {
        const { userId, phone, amount } = req.body;
        if (!userId || !phone || !amount) {
            return res.status(400).json({ error: "Missing userId, phone, or amount" });
        }

        const accessToken = await getAccessToken();
        const timestamp = timestampNow();
        const password = Buffer.from(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`).toString("base64");
        const formattedPhone = formatPhone(phone);

        const stkRes = await fetch(`${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                BusinessShortCode: MPESA_SHORTCODE,
                Password: password,
                Timestamp: timestamp,
                TransactionType: "CustomerPayBillOnline",
                Amount: amount,
                PartyA: formattedPhone,
                PartyB: MPESA_SHORTCODE,
                PhoneNumber: formattedPhone,
                CallBackURL: MPESA_CALLBACK_URL,
                AccountReference: "MovieDrift",
                TransactionDesc: "MovieDrift Subscription"
            })
        });

        const stkData = await stkRes.json();

        if (!stkData.CheckoutRequestID) {
            return res.status(502).json({ error: stkData.errorMessage || "M-Pesa did not return a CheckoutRequestID" });
        }

        await db.collection("payments").doc(stkData.CheckoutRequestID).set({
            userId,
            phone: formattedPhone,
            amount,
            status: "pending",
            createdAt: Date.now()
        });

        res.json({ checkoutRequestId: stkData.CheckoutRequestID });
    } catch (err) {
        console.error("initiateStkPush error:", err);
        res.status(500).json({ error: err.message });
    }
});

/* 2) M-PESA CALLBACK */
app.post("/mpesaCallback", async (req, res) => {
    try {
        const callback = req.body?.Body?.stkCallback;
        if (!callback) return res.status(400).send("No callback data");

        const checkoutRequestId = callback.CheckoutRequestID;
        const paymentRef = db.collection("payments").doc(checkoutRequestId);
        const paymentSnap = await paymentRef.get();
        if (!paymentSnap.exists) return res.status(404).send("Unknown payment");

        const payment = paymentSnap.data();

        if (callback.ResultCode === 0) {
            const items = callback.CallbackMetadata?.Item || [];
            const receipt = items.find(i => i.Name === "MpesaReceiptNumber")?.Value || null;

            await paymentRef.update({ status: "success", receipt, completedAt: Date.now() });

            const userRef = db.collection("users").doc(payment.userId);
            const userSnap = await userRef.get();
            const currentExpiry = userSnap.data()?.subscriptionExpiresAt || Date.now();
            const base = currentExpiry > Date.now() ? currentExpiry : Date.now();

            await userRef.update({
                status: "Paid",
                subscriptionExpiresAt: base + 30 * 24 * 60 * 60 * 1000,
                activeDevices: []
            });
        } else {
            await paymentRef.update({
                status: "failed",
                reason: callback.ResultDesc || "Payment was not completed",
                completedAt: Date.now()
            });
        }

        res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    } catch (err) {
        console.error("mpesaCallback error:", err);
        res.status(500).send("Server error");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));