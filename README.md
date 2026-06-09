# 🧠 NeuralBug – AI-Powered Bug Tracking & Project Management System

## Overview

NeuralBug is a full-stack AI-powered bug tracking and project management platform designed to help development teams identify, track, prioritize, and resolve software issues efficiently.

The platform combines bug management, sprint planning, analytics, role-based access control, and AI-assisted issue analysis into a single modern dashboard.

---

## Features

### Authentication & Security

* JWT Authentication
* Refresh Token Support
* Role-Based Access Control
* Password Reset Functionality
* Secure Password Hashing (bcrypt)

### Bug Management

* Create, Update, Delete Bugs
* Assign Bugs to Team Members
* Severity & Priority Management
* Status Tracking
* Activity Logs

### AI-Powered Features

* AI Bug Analysis
* Severity Prediction
* Fix Recommendations
* Pattern Detection
* Smart Issue Classification

### Project Management

* Sprint Planning
* Kanban Board
* Team Collaboration
* Progress Tracking

### Analytics Dashboard

* Open vs Closed Bugs
* Severity Distribution
* Resolution Metrics
* Team Performance Insights

### Real-Time Features

* WebSocket Notifications
* Live Updates
* Activity Feed

---

## Technology Stack

### Frontend

* HTML5
* CSS3
* JavaScript

### Backend

* Node.js
* Express.js

### Database

* SQLite

### Authentication

* JWT
* bcrypt

### Real-Time Communication

* WebSockets

---

## Project Structure

```text
NeuralBug/
├── frontend/
│   └── neuralbug.html
│
├── backend/
│   ├── routes/
│   ├── middleware/
│   ├── config/
│   ├── services/
│   ├── server.js
│   └── package.json
│
└── README.md
```

---

## Installation

### Clone Repository

```bash
git clone https://github.com/YOUR_USERNAME/neuralbug.git
cd neuralbug
```

### Install Dependencies

```bash
npm install
```

### Configure Environment Variables

Create a `.env` file:

```env
PORT=3001
JWT_SECRET=your_secret_key
JWT_REFRESH_SECRET=your_refresh_secret
```

### Start Server

```bash
npm start
```

Server runs at:

```text
http://localhost:3001
```

---

## API Endpoints

### Authentication

```http
POST /api/auth/login
POST /api/auth/register
POST /api/auth/refresh
POST /api/auth/logout
GET  /api/auth/me
```

### Bug Management

```http
GET    /api/bugs
POST   /api/bugs
PUT    /api/bugs/:id
DELETE /api/bugs/:id
```

---

## Screenshots

<img width="1907" height="886" alt="image" src="https://github.com/user-attachments/assets/13f5c291-aadc-4095-a98f-6765391458d2" />


## Future Enhancements

* Google OAuth Login
* GitHub Integration
* Jira Integration
* Slack Notifications
* AI Auto-Fix Suggestions
* Cloud Deployment

---

## Author

Aman Pandey

---

## License

This project is developed for educational and research purposes.
