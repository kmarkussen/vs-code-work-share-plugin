# Work Share Server

API server for the Work Share VS Code extension. Built with Node.js, Express, and routing-controllers.

## Features

- RESTful API for receiving file activity data
- Automatic validation using class-validator
- CORS enabled for VS Code extension
- Health check endpoint
- Docker support

## Development

### Install Dependencies

```bash
npm install
```

### Run in Development Mode

```bash
npm run dev
```

Server runs at `http://localhost:3000`

### Build

```bash
npm run build
```

### Run Production Build

```bash
npm start
```

## API Endpoints

### POST /activities

Receives file activity data from VS Code extension.

**Request Body:**

```json
{
    "activities": [
        {
            "filePath": "/path/to/file.ts",
            "userName": "John Doe",
            "timestamp": "2026-03-07T10:30:00.000Z",
            "action": "edit",
            "repositoryRemoteUrl": "https://github.com/org/repo.git"
        }
    ]
}
```

**Response:**

```json
{
    "success": true,
    "message": "Processed 1 activities",
    "timestamp": "2026-03-07T10:30:01.000Z"
}
```

### GET /activities

Returns tracked activities from memory.

**Query Parameters (optional):**

- `repositoryRemoteUrl`: Filter by repository remote URL
- `userName`: Filter by user name

**Examples:**

```bash
curl "http://localhost:3000/activities"
curl "http://localhost:3000/activities?repositoryRemoteUrl=https://github.com/org/repo.git"
curl "http://localhost:3000/activities?repositoryRemoteUrl=https://github.com/org/repo.git&userName=John%20Doe"
```

**Response:**

```json
{
    "count": 1,
    "activities": [
        {
            "filePath": "/path/to/file.ts",
            "userName": "John Doe",
            "timestamp": "2026-03-07T10:30:00.000Z",
            "action": "edit",
            "repositoryRemoteUrl": "https://github.com/org/repo.git",
            "receivedAt": "2026-03-07T10:30:01.000Z"
        }
    ]
}
```

### GET /health

Health check endpoint.

**Response:**

```json
{
    "status": "ok",
    "timestamp": "2026-03-07T10:30:00.000Z"
}
```

## Docker

Build and run with Docker:

```bash
docker build -t work-share-server .
docker run -p 3000:3000 work-share-server
```

Or use docker-compose from the root directory:

```bash
cd ..
docker-compose up
```
