# 💊 PharmaDash

**Live website:** [pharmadash-app.onrender.com](https://pharmadash-app.onrender.com)

PharmaDash is a professional, full-stack pharmacy delivery and management platform. It features real-time rider tracking, AI-powered prescription scanning, and an advanced analytics dashboard for administrators.

---

## 🚀 Key Features

### 👤 For Customers
- **Smart Search:** Find medicines and generics in seconds.
- **AI Prescription Scanner:** Upload a photo of a prescription; our AI extracts the medicines and populates your cart automatically.
- **🚨 SOS Emergency Mode:** Need medicine urgently? Toggle SOS for dedicated, non-batched, high-priority delivery.
- **Live GPS Tracking:** Watch your rider move in real-time on a live map from the pharmacy to your doorstep.

### 🛵 For Riders
- **Order Management:** View available pickups and manage active deliveries.
- **Integrated Mapping:** Built-in maps showing pickup (Pharmacy) and drop-off (Customer) locations.
- **Status Control:** One-tap updates for Pickup, Out for Delivery, and Delivered.

### 📊 For Administrators
- **Intelligence Dashboard:** Monitor total revenue, active orders, and user demographics.
- **Inventory Monitoring:** Real-time stock tracking with automated **Low Stock Alerts**.
- **User Management:** Oversee all customers and riders on the platform.

---

## 🛠 Tech Stack

- **Frontend:** React.js, Vite, Vanilla CSS (Premium Aesthetics), Leaflet.js (Maps), Socket.io-client.
- **Backend:** Node.js, Express, Socket.io (Real-time Telemetry), TypeScript.
- **Database:** PostgreSQL (via Supabase), Prisma ORM.
- **Authentication:** JWT (JSON Web Tokens) with role-based access control.

---

## 📦 Installation & Setup

### 1. Prerequisites
- Node.js (v22.12+ recommended)
- PostgreSQL Database (Supabase recommended)

### 2. Clone the Repository
```bash
git clone https://github.com/devesh3001/PharmaDash.git
cd PharmaDash
```

### 3. Backend Setup
```bash
cd backend
npm install
```
Create a `.env` file in the `backend` folder:
```env
DATABASE_URL="your_postgresql_pooled_url"
DIRECT_URL="your_postgresql_direct_url"
JWT_SECRET="your_secret_key"
```
Run database migrations:
```bash
npx prisma db push
npx prisma generate
```
Start the backend:
```bash
npm run dev
```

### 4. Frontend Setup
```bash
cd ../customer-app
npm install
npm run dev
```

---

## 🗺 Project Structure

```text
PharmaDash/
├── backend/               # Node.js + Express API
│   ├── prisma/            # Database schema & seeds
│   └── src/               # API Source code
└── customer-app/          # React.js Frontend
    ├── public/            # Static assets
    └── src/
        ├── api/           # Backend communication
        ├── components/    # UI Components
        ├── context/       # Auth & State management
        └── pages/         # Application Views
```

---

## 📄 License
This project is for educational/demo purposes.

## Verification

Run `npm run test:smoke` in `backend` for isolated API regression checks and storage tests. Run `npm run db:generate` followed by `npm run test:integration` for the full suite against disposable local PostgreSQL, including real OCR, prescriptions, payments, delivery and tracking. Run `npm run lint` and `npm run build` in `customer-app` for frontend checks. With the backend running and demo users seeded, `node scripts/smoke-readonly.cjs` in `backend` checks the public APIs and all four demo roles without modifying orders or inventory.

The integration runner provisions a loopback-only PostgreSQL instance automatically and applies all migrations. Direct `npm test` runs require `TEST_DATABASE_URL` pointing to a migrated disposable PostgreSQL database whose name contains `test`. These tests clear database tables; do not use application data. See [SMOKE_TEST_REPORT.md](SMOKE_TEST_REPORT.md) for results and coverage limits.

SOS orders carry a 99 priority fee, appear first for riders, and require a dedicated rider without another active delivery. The scanner uses OCR to suggest exact catalogue matches for review; it does not replace pharmacist prescription approval.
