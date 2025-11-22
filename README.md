# BA Exams - Backend API

The backend server for **BA Exams** (Bethunana Academy), a digital testing platform that allows students to complete Mathematics and Physical Science assessments online.

This repository contains the **Node.js & Express** REST API which handles logic, database interactions, and serves the React frontend static files.

## 🚀 Features

- **Hybrid Server:** Acts as both a REST API and a static file server for the React frontend.
- **Authentication:** Secure user management (Sign up/Login) integrated with **Supabase Auth**.
- **Test Management:** Endpoints for creating, retrieving, and managing tests.
- **Auto-Marking:** Logic to process student answers and calculate grades automatically.
- **Progress Tracking:** Persistent storage of student results and progress using **PostgreSQL** (via Supabase).

## 🛠 Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** PostgreSQL (managed via Supabase)
- **Auth:** Supabase Auth
- **Deployment:** AWS Lightsail (Ubuntu/Nginx)

## 📂 Directory Structure

```text
/
├── controllers/   # Request handlers (Auth, Tests, Marking)
├── routes/        # API route definitions
├── middleware/    # Auth verification middleware
├── public/        # Built React frontend files (served on root)
├── index.js       # Entry point
└── .env           # Environment variables (Not committed)
