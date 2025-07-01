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
    const requiredFields = ["name", "sapid", "email", "phoneNumber", "preference1", "preference2", "preference3", "year"];
    const missing = requiredFields.filter(f => !data[f]);
    if (missing.length) {
      return res.status(400).json({ message: `Missing: ${missing.join(", ")}` });
    }

    // Format validations
    const sapidPattern = /^[0-9]{9}$/;
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phonePattern = /^[0-9]{10}$/;

    if (!sapidPattern.test(data.sapid)) {
      return res.status(400).json({ message: "Invalid SAP ID. Must be 9 digits." });
    }

    if (!emailPattern.test(data.email)) {
      return res.status(400).json({ message: "Invalid email format." });
    }

    if (!phonePattern.test(data.phoneNumber)) {
      return res.status(400).json({ message: "Invalid Phone Number. Must be 10 digits." });
    }

    // Preference uniqueness check
    const preferences = [data.preference1, data.preference2, data.preference3];
    const uniquePreferences = new Set(preferences);
    if (uniquePreferences.size !== preferences.length) {
      return res.status(400).json({ message: "Each team preference must be unique." });
    }

    const client = await connectToDatabase();
    const db = client.db("registration_db");
    const collection = db.collection("users");

    // Duplicate check on SAP ID, email, and phone number
    const existing = await collection.findOne({
      $or: [
        { sapid: data.sapid },
        { email: data.email.toLowerCase() },
        { phoneNumber: data.phoneNumber }
      ]
    });

    if (existing) {
      if (existing.sapid === data.sapid) {
        return res.status(409).json({ message: "SAP ID already registered." });
      } else if (existing.email.toLowerCase() === data.email.toLowerCase()) {
        return res.status(409).json({ message: "Email already registered." });
      } else if (existing.phoneNumber === data.phoneNumber) {
        return res.status(409).json({ message: "Phone number already registered." });
      }
    }

    // Insert data
    await collection.insertOne({ ...data, timestamp: new Date() });
    return res.status(201).json({ message: "Registration successful!" });

  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({ message: "Server Error", error: err.message });
  }
}
