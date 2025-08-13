import fs from "fs";
import fetch from "node-fetch";

const host = "firewall"; // o il nome del servizio se usi docker-compose
const port = 5001;

console.log("Avvio client")
/* 
// Legge il PEM dalla stessa cartella del file JS
const privateKey = fs.readFileSync(new URL("./private_key.pem", import.meta.url), "utf-8").trim();

async function sendCommandHttp(command, privateKey, host, port) {
  const bodyData = { command, client_id: null };
  const url = `http://${host}:${port}/dashboard/command`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyData)
    });

    if (!response.ok) {
      console.error("[ERROR] Server responded with status:", response.status);
      return null;
    }

    return await response.json();
  } catch (err) {
    console.error("[ERROR] Failed to send command:", err);
    return null;
  }
}

(async () => {
  const response = await sendCommandHttp("list_rooms", privateKey, host, port);

  if (!response) {
    console.error("[ERROR] No response or error from server");
  } else if (response.rooms) {
    console.log("[CLIENT] Rooms list:");
    for (const room of response.rooms) {
      console.log(` - ${room.name}: ${room.clients} client(s), ${room.messages} message(s)`);
    }
  } else {
    console.log("[CLIENT] Response:", response);
  }
})(); */