# Apex Digital Bank - Modern Online Banking & Management System

A full-stack, responsive web application designed for comprehensive digital banking services. The system provides role-based access for bank customers and branch managers, allowing seamless fund transfers, account management, loan processing, KYC verification, grievance redressal, and financial analytics.

---

## 📌 Project Overview

**Apex Digital Bank** is designed to simulate modern retail and commercial banking operations with high security, intuitive user experience, and real-time transaction processing. The system implements a modern component-driven frontend combined with an Express and TypeScript backend.

---

## 🚀 Key Features

### 👤 1. Customer Banking Portal
* **Account Dashboard**: Real-time balance view, account summary, and interactive cash flow charts.
* **Money Transfers**:
  * Instant Quick Transfers using Account Number or UPI ID.
  * Beneficiary / Payee management for frequent transfers.
  * Security PIN / Transaction authorization.
* **Bill Payments & Recharges**: Utility bills (Electricity, Mobile, Broadband, Water, DTH) with instant receipt generation.
* **Virtual Debit Cards**: Card management, CVV toggle, PIN setting, and spending limit controls.
* **Fixed Deposits (FD) & Recurring Deposits (RD)**: Create deposits with interest calculations and maturity tracking.
* **Loan Applications**: Apply for Personal, Home, Vehicle, Education, and Gold loans with an interactive EMI calculator.
* **e-Statements & Reports**: View transaction history, apply custom filters, and download official PDF bank statements.
* **Customer Support & Grievances**: Raise complaints, report dispute transactions, and track resolution status.
* **Theme Customization**: Dedicated Light Mode and Dark Mode support for optimal viewing.

### 👔 2. Branch Manager & Admin Console
* **Branch Overview**: Liquidity metrics, total deposits, cash withdrawals, active accounts, and cash flow trends.
* **Customer Account Operations**:
  * Open new customer savings/current accounts.
  * Freeze or unfreeze flagged accounts.
  * Direct branch cash deposit / balance credit.
* **KYC Approvals**: Review Aadhaar and PAN documents submitted by customers with single-click approval or rejection.
* **Loan Sanctioning & Disbursal**: Evaluate loan applications, interest rates, tenures, and disburse sanctioned funds directly into customer accounts.
* **Grievance Redressal**: Respond to and resolve customer disputes and service queries.
* **Transaction Ledger & AML Surveillance**: Complete audit trail of all transactions with Anti-Money Laundering (AML) flags, clearance controls, and CSV export.

---

## 🛠️ Technology Stack

| Layer | Technologies Used |
| :--- | :--- |
| **Frontend** | React 19, TypeScript, Tailwind CSS, Lucide React (Icons), Motion |
| **Data Visualization** | Recharts (Financial analytics & trends) |
| **PDF Generation** | jsPDF, jsPDF-AutoTable (e-Statements & receipts) |
| **Backend / Server** | Node.js, Express, TypeScript (TSX / ESBuild) |
| **Security & Utilities** | JWT (JSON Web Tokens), BCrypt.js (Password hashing) |
| **Build Tooling** | Vite, PostCSS |

---

## 📂 Project Directory Structure

```text
├── src/
│   ├── components/
│   │   ├── admin/               # Manager portal modules (KYC, Loans, Customers, Overview)
│   │   ├── customer/            # Customer banking modules (Transfers, Cards, FD/RD, Loans)
│   │   ├── AdminView.tsx        # Main Manager Console layout & tabs
│   │   ├── CustomerView.tsx     # Main Customer Dashboard layout
│   │   ├── Navbar.tsx           # Navigation header with profile & notifications
│   │   └── Sidebar.tsx          # Responsive navigation sidebar
│   ├── context/
│   │   └── AuthContext.tsx      # Global authentication, user session & theme state
│   ├── data/
│   │   └── initialData.ts       # Sample accounts, transactions & branch metrics
│   ├── types.ts                 # TypeScript type definitions and interfaces
│   ├── utils/
│   │   └── formatters.ts        # Currency (INR ₹) & date formatting helpers
│   ├── App.tsx                  # Main application router and view controller
│   ├── main.tsx                 # React DOM entry point
│   └── index.css                # Global Tailwind CSS styles
├── server.ts                    # Express API server, endpoints & business logic
├── package.json                 # Project dependencies and npm scripts
├── tsconfig.json                # TypeScript configuration
└── vite.config.ts               # Vite bundler configuration
```

---

## 💻 Installation & Setup

### Prerequisites
* **Node.js** (v18.0 or higher recommended)
* **npm** or **yarn** package manager

### Steps to Run Locally:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/apex-digital-bank.git
   cd apex-digital-bank
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```

4. **Open in Browser:**
   * Navigate to `http://localhost:3000`

5. **Build for Production:**
   ```bash
   npm run build
   npm start
   ```

---

## 🔒 Security Measures Implemented
* **Client-Side Validation**: Form inputs, amounts, and account number formats validated before submission.
* **Protected Routing**: Role-based access control preventing unauthorized access between customer and manager modules.
* **Audit Logging**: Every financial transaction generates an immutable reference ID and audit timestamp.
* **AML Verification**: Automatic tagging of large or unusual transactions for managerial review.

---

## 🎓 Academic Project Details

* **Project Title**: Apex Digital Banking and Management System
* **Domain**: Web Development / FinTech Application
* **Type**: Full-Stack Web Application

---

## 📄 License
This project is developed for educational and demonstration purposes.
