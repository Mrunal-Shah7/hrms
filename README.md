# HRMS Platform

Multi-tenant Human Resource Management System.

## Structure

- `frontend/` — Next.js (TypeScript, Tailwind, shadcn/ui)
- `backend/` — NestJS (TypeScript, Prisma, PostgreSQL)
- `packages/shared/` — Shared types and constants

## Setup

### Prerequisites
- Node.js 18+
- PostgreSQL 15+

### Backend
```bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev
npx prisma db seed
npm run start:dev
```
Server runs at http://localhost:3001

### Frontend
```bash
cd frontend
npm install
npm run dev
```
App runs at http://localhost:3000
