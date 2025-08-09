**Progetto Sicurezza di Rete**
# Descrizione
Questo progetto implementa un'infrastruttura di sicurezza di rete completa con i seguenti componenti:

Reverse Proxy NGINX per instradare le richieste verso due server backend (server1 e server2)
Firewall programmabile con regole personalizzate
Honeypot per intercettare traffico sospetto
File receiver per ricevere file via rete
Client Python per inviare file o messaggi ai server backend
Dashboard per monitorare lo stato della rete (in sviluppo)

Il sistema supporta comunicazione via HTTP per messaggi di testo. Il progetto utilizza Docker Compose per orchestrare i vari container e la rete bridge per l'interconnessione.
Prerequisiti

Docker (>= 20.x)
Docker Compose (>= 1.29.x)
Python 3.8+ (per eseguire il client manualmente)
(Opzionale) Certificati SSL/TLS per HTTPS (per future implementazioni)

Installazione e Avvio

Clona il repository:
bashgit clone https://github.com/Nick-Maro/docker-mini-network
cd docker-mini-network

Costruisci i container Docker:
bashdocker compose build

Avvia i container (in background):
bashdocker compose up -d

Controlla che i container siano attivi:
bashdocker compose ps


Architettura del Progetto

reverse-proxy: NGINX configurato per fare load balancing tra server1 e server2 (porta 8080)
server1 e server2: backend Python in ascolto sulla porta 5000
firewall: modulo programmabile per filtrare il traffico tra client e backend
honeypot: cattura e logga traffico sospetto per analisi
file-receiver: servizio che riceve file e li salva in /uploads
client: script Python per inviare file o messaggi ai backend
dashboard: frontend per visualizzare dati e log di sistema

Come Usare il Client

Entra nella cartella client:
bashcd client

Avvia il client Python:
bashpython sender.py

Inserisci quando richiesto:

Host del server: localhost (o IP remoto)
Porta: 5000 ← la porta su cui è in ascolto il backend


Scegli il tipo di invio:

f per inviare un file (inserisci il percorso completo)
m per inviare un messaggio testuale
q per uscire



Il client invierà il file o il messaggio e mostrerà la risposta ricevuta.
Configurazione del Reverse Proxy (NGINX)
Il file principale è reverse-proxy/nginx.conf, che contiene:

Un blocco upstream con i server backend (server1, server2) su porta 5000
Proxy pass verso upstream su porta 8080
Impostazioni per gestire header utili al backend (es. IP reale, Host)

Test del proxy:
bashcurl -X POST http://localhost:5000/command -H "Content-Type: application/json" -d "{\"command\":\"ciao\"}"
Firewall Programmabile
Il firewall si basa su regole definite in rules.json e gestite tramite script Python (firewall.py, CLI fwcli.py).
Viene integrato tra client e reverse proxy per filtrare il traffico.
Honeypot
L'honeypot registra tentativi di accesso e traffico sospetto. Può essere utilizzato per instradare richieste malevole e analizzare i log.
Aggiungere TLS/SSL (Sviluppo Futuro)
Per implementare la sicurezza TLS/SSL:

Configurare certificati SSL (self-signed o Let's Encrypt) per abilitare HTTPS su NGINX
Estendere la sicurezza anche nel backend
Modificare il client per usare HTTPS
Testare la connessione crittografata end-to-end

Log e Debug

I log di NGINX si trovano in /var/log/nginx/ dentro il container reverse-proxy
I log degli altri servizi sono accessibili tramite docker logs <nome-container>
Usa docker-compose logs -f per seguire i log in tempo reale

Comandi Utili Docker
bash# Avvia container in foreground
docker compose up

# Avvia container in background
docker compose up -d

# Costruisci o ricostruisci i container
docker compose build

# Ferma e rimuovi container
docker compose down

# Vedi lo stato dei container
docker compose ps

# Vedi log in tempo reale di un container
docker compose logs -f reverse-proxy
Sviluppi Futuri

 Integrare TLS/SSL
 Dashboard operativa per monitoraggio in tempo reale
 Regole firewall più complesse
 Maggiori funzionalità di honeypot
 Supporto a protocolli diversi (es. HTTPS, WebSocket)
 Portare tutto in inglese
 (opzionale) implementare Protocollo udp


Contribuire
Per contribuire al progetto, seguire le best practices per Docker e la sicurezza di rete. Assicurarsi di testare tutte le modifiche prima di effettuare commit.