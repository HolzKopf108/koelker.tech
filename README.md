# koelker.tech

Minimalistische, animierte persönliche Website auf Basis von Angular.
Die Seite dient als technische Lernplattform und persönliche Präsenz
und wird über Docker und Traefik ausgeliefert.

---

## Ziel der Website

- Minimalistisches Design
- Dezente Animationen
- Einsatz von Angular zum Lernen und für reale Projekte
- Server-Side Rendering (SSR)
- Betrieb hinter Traefik (lokal und produktiv)
- Manuelles Deployment ohne CI/CD

---

## Lokale Entwicklung (Angular Dev Server)

### Voraussetzungen

- Docker
- Docker Compose
- Lokal laufendes Traefik
- Lokale Domain (z. B. `koelker.lan` via Pi-hole)

---

### Start local
1. VPN nach Home verbinden für die lokale Domain
2. Traefik starten:
```bash
docker compose `
  --env-file "C:\Repository\ServerSoftware\webserver-02\traefik\.env.local" `
  -f "C:\Repository\ServerSoftware\webserver-02\traefik\compose.local.yml" `
  up -d
```
3. Start redis:
```bash
docker compose `
  --env-file "C:\Repository\ServerSoftware\webserver-02\redis\.env.prod" `
  -f "C:\Repository\ServerSoftware\webserver-02\redis\compose.yml" `
  up -d
```
4. Angular starten:
```bash
docker compose `
  --env-file .env.local `
  -f compose.local.yml `
  up
```

Die Website ist anschließend erreichbar unter:

http://koelker.lan

Hot Reload ist aktiv. Änderungen am Quellcode werden automatisch übernommen,
ohne dass der Container neu gestartet werden muss.

---

### Stop local
1. Angular stoppen:
```bash
docker compose `
  --env-file .env.local `
  -f compose.local.yml `
  down
```
2. Stop redis:
```bash
docker compose `
  --env-file "C:\Repository\ServerSoftware\webserver-02\redis\.env.prod" `
  -f "C:\Repository\ServerSoftware\webserver-02\redis\compose.yml" `
  down
```
3. Traefik stoppen:
```bash
docker compose `
  --env-file "C:\Repository\ServerSoftware\webserver-02\traefik\.env.local" `
  -f "C:\Repository\ServerSoftware\webserver-02\traefik\compose.local.yml" `
  down
```
4. VPN lösen

---

## Production Deployment (Build lokal, Upload per SCP)

### Voraussetzungen

- Lokal: Docker Engine
- Server: Docker Engine + Docker Compose Plugin
- Projektpfad auf dem Server: `/srv/koelker.tech`
- Traefik läuft bereits auf dem Server

---

### 1) Image lokal bauen

Im Projektverzeichnis:

```bash
docker build `
  -t koelker-tech:latest `
  -t koelker-tech:$(git rev-parse --short HEAD) `
  .
```

Optionaler Test:

```bash
docker run --rm koelker-tech:latest node -v
```

---

### 2) Image exportieren und komprimieren

```bash
docker save koelker-tech:latest -o dist/koelker-tech.latest.tar
```

In Git Bash:

```bash
gzip dist/koelker-tech.latest.tar
```

---

### 3) Upload auf den Server

```bash
scp dist/koelker-tech.latest.tar.gz user@SERVER:/srv/koelker.tech/images/
```

---

### 4) Server: Image importieren

```bash
ssh user@SERVER
cd /srv/koelker.tech/images
gunzip koelker-tech.latest.tar.gz
docker load -i koelker-tech.latest.tar
rm koelker-tech.latest.tar
```

---

### 5) Production starten

```bash
cd /srv/koelker.tech
docker compose -f compose.yml --env-file .env.prod up -d
```

---

### Production stoppen

```bash
docker compose -f compose.yml --env-file .env.prod down
```

---

### Logs anzeigen

```bash
docker compose logs -f --tail=200 koelker-tech
```

---

### Cleanup (optional)

Alte, ungenutzte Images entfernen:

```bash
docker image prune -f
```
