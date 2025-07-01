import { MongoClient } from "mongodb";

// MongoDB connection
const uri = process.env.MONGODB_URI;
let cachedClient = null;

async function connectToDatabase() {
  if (cachedClient) return cachedClient;
  const client = new MongoClient(uri);
  await client.connect();
  cachedClient = client;
  return client;
}

// Fallback body parser for production (Vercel raw requests)
async function readBody(req) {
  if (req.headers['content-type'] !== 'application/json') {
    throw new Error("Unsupported content type");
  }

  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
  }

  raw = raw.trim();
  if (!raw) throw new Error("Empty request body");

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON");
  }
}

// API route
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  try {
    let data;
    if (req.body) {
      data = req.body;
    } else {
      data = await readBody(req);
    }

    console.log("Received:", data);

    // Required fields check
    const requiredFields = ["name", "sapid", "email", "preference1", "preference2", "preference3", "year"];
    const missing = requiredFields.filter(f => !data[f]);
    if (missing.length) {
      return res.status(400).json({ message: `Missing: ${missing.join(", ")}` });
    }

    // Format checks
    const sapidPattern = /^[0-9]{9}$/;
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!sapidPattern.test(data.sapid)) {
      return res.status(400).json({ message: "Invalid SAP ID. Must be 9 digits." });
    }

    if (!emailPattern.test(data.email)) {
      return res.status(400).json({ message: "Invalid email format." });
    }

    const client = await connectToDatabase();
    const db = client.db("registration_db");
    const collection = db.collection("users");

    // Duplicate check
    const existing = await collection.findOne({
      $or: [{ sapid: data.sapid }, { email: data.email.toLowerCase() }]
    });

    if (existing) {
      return res.status(409).json({
        message: existing.sapid === data.sapid
          ? "SAP ID already registered."
          : "Email already registered."
      });
    }

    // Insert data
    await collection.insertOne({ ...data, timestamp: new Date() });
    return res.status(201).json({ message: "Registration successful!" });

  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({ message: "Server Error", error: err.message });
  }
}
