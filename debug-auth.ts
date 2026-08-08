import { spawn } from 'child_process';
import { createToken } from './src/lib/auth';

process.env.JWT_SECRET = "test-secret-for-tests";
process.env.DATABASE_URL = "file:./test.db";
const prisma = require("./src/lib/prisma").prisma;

async function test() {
  const user = await prisma.user.findFirst();
  console.log("Found user:", user);
  const token = await createToken({ userId: user.id, email: user.email, role: "ADMIN" });
  console.log("Created token:", token);
  
  const res = await fetch('http://127.0.0.1:3005/api/purchases', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `auth-token=${token}`
    },
    body: JSON.stringify({}) // Just want to see if it passes auth
  });
  
  const text = await res.text();
  console.log("Status:", res.status);
  console.log("Response:", text);
}
test();
