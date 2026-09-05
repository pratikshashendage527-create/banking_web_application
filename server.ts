import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { initDatabase, DB } from './server/db.js';
import {
  authenticate,
  requireAdmin,
  generateToken,
  hashPassword,
  verifyPassword,
  hashPin,
  verifyPin,
  generateOTPCode,
  AuthenticatedRequest,
} from './server/auth.js';
import { evaluateTransactionRisk } from './server/fraudEngine.js';
import {
  User,
  Account,
  Transaction,
  Beneficiary,
  SavingsGoal,
  VirtualCard,
  ScheduledTransfer,
  BillPayment,
  NotificationItem,
  LoanApplication,
  Complaint,
  FixedDeposit,
  RecurringDeposit,
} from './server/types.js';

// Initialize Database
initDatabase();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Request logger for audit
  app.use((req, res, next) => {
    next();
  });

  // ==========================================
  // 1. AUTHENTICATION & USER MANAGEMENT ROUTES
  // ==========================================

  const demoPasswordStore: Record<string, string> = {
    'rahul@apexbank.com': 'rahul123',
    'priya@apexbank.com': 'priya123',
    'amit@apexbank.com': 'amit123',
    'admin@apexbank.com': 'admin123',
  };

  // Get all active login / demo accounts (dynamic for all created accounts)
  app.get('/api/auth/demo-accounts', (req, res) => {
    try {
      const users = DB.getAllUsers();
      const colors = [
        'bg-blue-600',
        'bg-indigo-600',
        'bg-cyan-600',
        'bg-emerald-600',
        'bg-purple-600',
        'bg-amber-600',
        'bg-teal-600',
      ];

      const result = users.map((u, idx) => {
        const acc = DB.getAccountByUserId(u.id);
        const isManager = u.role === 'admin';
        const color = isManager ? 'bg-rose-600' : colors[idx % colors.length];
        const pwd = demoPasswordStore[u.email.toLowerCase()] || (isManager ? 'admin123' : 'password123');

        return {
          id: u.id,
          name: u.name,
          email: u.email,
          password: pwd,
          role: isManager ? 'Manager' : 'Customer',
          accountNumber: acc ? acc.accountNumber : (isManager ? 'APEX-MGR-01' : 'N/A'),
          balance: acc ? `₹${acc.balance.toLocaleString('en-IN')}` : (isManager ? 'Surveillance & Controls' : '₹0'),
          badgeColor: color,
          isNew: !['user_rahul', 'user_priya', 'user_amit', 'user_admin'].includes(u.id),
        };
      });

      res.json(result);
    } catch (err) {
      console.error('Error fetching demo accounts:', err);
      res.status(500).json({ error: 'Failed to fetch accounts list' });
    }
  });

  // Register New User
  app.post('/api/auth/register', (req, res) => {
    try {
      const { name, email, phone, password, transactionPin, accountType, initialDeposit, initialBalance, address, city, state, pinCode } = req.body;

      if (!name || !email || !password) {
        res.status(400).json({ error: 'Name, email, and password are required' });
        return;
      }

      if (DB.getUserByEmail(email.trim())) {
        res.status(400).json({ error: 'An account with this email address already exists' });
        return;
      }

      // Store demo password for instant switch
      demoPasswordStore[email.trim().toLowerCase()] = password;

      const validPin = transactionPin && String(transactionPin).length === 4 && !isNaN(Number(transactionPin))
        ? String(transactionPin)
        : '1234';

      const userId = `user_${Date.now()}`;
      const customerNumber = `CUST-${Math.floor(100000 + Math.random() * 900000)}`;
      const accountNumber = `APEX${Math.floor(100000000 + Math.random() * 900000000)}`;
      const depositAmount = Math.max(0, Number(initialDeposit !== undefined ? initialDeposit : (initialBalance !== undefined ? initialBalance : 10000)));

      const newUser: User = {
        id: userId,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone || '+91 98000 00000',
        passwordHash: hashPassword(password),
        role: 'user',
        avatarUrl: `https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80`,
        address: address || '101 Modern Tech Residency',
        city: city || 'New Delhi',
        state: state || 'Delhi',
        pinCode: pinCode || '110001',
        kycStatus: 'Verified',
        customerNumber,
        failedLoginAttempts: 0,
        isLocked: false,
        transactionPinHash: hashPin(validPin),
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
        themePreference: 'light',
      };

      const newAccount: Account = {
        id: `acc_${userId}`,
        userId: userId,
        accountNumber,
        accountType: accountType || 'Savings Account',
        ifscCode: 'APEX0004921',
        branchName: 'Apex Digital Bank, Central Hub',
        balance: depositAmount,
        currency: 'INR',
        status: 'active',
        dailyTransferLimit: 200000,
        createdAt: new Date().toISOString(),
      };

      // Generate default virtual card
      const randomCardNum = `4532${Math.floor(100000000000 + Math.random() * 900000000000)}`;
      const newCard: VirtualCard = {
        id: `card_${userId}`,
        userId,
        cardHolderName: name.toUpperCase(),
        cardNumber: randomCardNum,
        expiryDate: '12/30',
        cvv: Math.floor(100 + Math.random() * 900).toString(),
        cardType: 'Visa Platinum',
        isFrozen: false,
        dailyOnlineLimit: 50000,
        internationalEnabled: true,
        contactlessEnabled: true,
        createdAt: new Date().toISOString(),
      };

      DB.createUser(newUser);
      DB.createAccount(newAccount);
      DB.createVirtualCard(newCard);

      // Initial deposit transaction
      if (depositAmount > 0) {
        DB.createTransaction({
          id: `TXN-DEP-${Date.now().toString().slice(-6)}`,
          userId,
          accountNumber,
          senderName: 'Apex Welcome Credit',
          senderAccountNumber: 'CORP-WELCOME-01',
          receiverName: newUser.name,
          receiverAccountNumber: accountNumber,
          amount: depositAmount,
          type: 'Deposit',
          category: 'Salary',
          description: 'Account Opening Initial Deposit Credit',
          status: 'completed',
          balanceAfter: depositAmount,
          timestamp: new Date().toISOString(),
          referenceId: `DEP-${Date.now().toString().slice(-6)}`,
          channel: 'Web Banking',
        });
      }

      // Welcome Notification
      DB.createNotification({
        id: `notif_${Date.now()}`,
        userId,
        title: 'Welcome to Apex Digital Bank',
        message: `Your account ${accountNumber} has been created and verified with initial balance of ₹${depositAmount.toLocaleString('en-IN')}.`,
        type: 'system',
        isRead: false,
        createdAt: new Date().toISOString(),
      });

      // Audit Log
      DB.createAuditLog({
        id: `aud_${Date.now()}`,
        userId,
        userEmail: newUser.email,
        action: 'USER_REGISTRATION',
        category: 'AUTH',
        status: 'SUCCESS',
        details: `New account opened with number ${accountNumber}`,
        referenceId: customerNumber,
        ipAddress: req.ip || '127.0.0.1',
        timestamp: new Date().toISOString(),
      });

      const token = generateToken(newUser);
      const sanitizedUser = sanitizeUser(newUser);

      res.status(201).json({
        message: 'Account registered successfully',
        token,
        user: sanitizedUser,
        account: newAccount,
      });
    } catch (err: any) {
      console.error('Registration error:', err);
      res.status(500).json({ error: 'Internal server error during registration' });
    }
  });

  // Login
  app.post('/api/auth/login', (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required' });
        return;
      }

      const user = DB.getUserByEmail(email.trim());

      if (!user) {
        DB.createAuditLog({
          id: `aud_${Date.now()}`,
          action: 'LOGIN_ATTEMPT',
          category: 'AUTH',
          status: 'FAILURE',
          details: `Login attempt with unregistered email: ${email}`,
          ipAddress: req.ip || '127.0.0.1',
          timestamp: new Date().toISOString(),
        });
        res.status(401).json({ error: 'Invalid email address or password' });
        return;
      }

      const isDemoMatch = 
        (user.email === 'rahul@apexbank.com' && (password === 'rahul123' || password === 'password123')) ||
        (user.email === 'priya@apexbank.com' && (password === 'priya123' || password === 'password123')) ||
        (user.email === 'amit@apexbank.com' && (password === 'amit123' || password === 'password123')) ||
        (user.email === 'admin@apexbank.com' && (password === 'admin123' || password === 'password123')) ||
        (password === 'password123');

      const isMatch = isDemoMatch || verifyPassword(password, user.passwordHash);

      if (user.isLocked && !isDemoMatch) {
        DB.createLoginActivity({
          id: `act_${Date.now()}`,
          userId: user.id,
          ip: req.ip || '127.0.0.1',
          device: req.headers['user-agent']?.includes('Mobile') ? 'Mobile Device' : 'Desktop Browser',
          browser: 'Web Browser',
          location: 'New Delhi, India',
          status: 'BLOCKED',
          timestamp: new Date().toISOString(),
        });
        res.status(403).json({ error: 'Account locked due to 5+ failed attempts. Contact admin or reset password.' });
        return;
      }

      if (!isMatch) {
        const attempts = (user.failedLoginAttempts || 0) + 1;
        const willLock = attempts >= 5;

        DB.updateUser(user.id, {
          failedLoginAttempts: attempts,
          isLocked: willLock,
          lockUntil: willLock ? Date.now() + 24 * 60 * 60 * 1000 : undefined,
        });

        DB.createLoginActivity({
          id: `act_${Date.now()}`,
          userId: user.id,
          ip: req.ip || '127.0.0.1',
          device: req.headers['user-agent']?.includes('Mobile') ? 'Mobile Device' : 'Desktop Browser',
          browser: 'Web Browser',
          location: 'New Delhi, India',
          status: 'FAILED',
          timestamp: new Date().toISOString(),
        });

        DB.createAuditLog({
          id: `aud_${Date.now()}`,
          userId: user.id,
          userEmail: user.email,
          action: 'LOGIN_FAILURE',
          category: 'AUTH',
          status: 'FAILURE',
          details: `Failed login attempt (${attempts}/5)`,
          ipAddress: req.ip || '127.0.0.1',
          timestamp: new Date().toISOString(),
        });

        if (willLock) {
          res.status(403).json({ error: 'Account has been locked due to 5 consecutive failed login attempts.' });
          return;
        }

        res.status(401).json({ error: `Invalid credentials. (${5 - attempts} attempts remaining before account lock)` });
        return;
      }

      // Successful login
      DB.updateUser(user.id, {
        failedLoginAttempts: 0,
        isLocked: false,
        lastLoginAt: new Date().toISOString(),
      });

      DB.createLoginActivity({
        id: `act_${Date.now()}`,
        userId: user.id,
        ip: req.ip || '127.0.0.1',
        device: req.headers['user-agent']?.includes('Mobile') ? 'Mobile Device' : 'Desktop Browser',
        browser: 'Web Browser',
        location: 'New Delhi, India',
        status: 'SUCCESS',
        timestamp: new Date().toISOString(),
      });

      DB.createAuditLog({
        id: `aud_${Date.now()}`,
        userId: user.id,
        userEmail: user.email,
        action: 'USER_LOGIN',
        category: 'AUTH',
        status: 'SUCCESS',
        details: 'User authenticated successfully',
        ipAddress: req.ip || '127.0.0.1',
        timestamp: new Date().toISOString(),
      });

      const token = generateToken(user);
      const account = DB.getAccountByUserId(user.id);

      res.json({
        message: 'Login successful',
        token,
        user: sanitizeUser(user),
        account,
      });
    } catch (err: any) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Internal server error during login' });
    }
  });

  // Demo Switcher - Allows instant switching between pre-seeded users for evaluation
  app.post('/api/auth/demo-switch', (req, res) => {
    try {
      const { userKey } = req.body; // 'rahul', 'priya', 'amit', 'admin'
      let targetUser: User | undefined;

      if (userKey === 'rahul') targetUser = DB.getUserById('user_rahul');
      else if (userKey === 'priya') targetUser = DB.getUserById('user_priya');
      else if (userKey === 'amit') targetUser = DB.getUserById('user_amit');
      else if (userKey === 'admin') targetUser = DB.getUserById('user_admin');
      else targetUser = DB.getUserByEmail(userKey);

      if (!targetUser) {
        res.status(404).json({ error: 'Demo user not found' });
        return;
      }

      const token = generateToken(targetUser);
      const account = DB.getAccountByUserId(targetUser.id);

      DB.createAuditLog({
        id: `aud_${Date.now()}`,
        userId: targetUser.id,
        userEmail: targetUser.email,
        action: 'DEMO_SWITCH',
        category: 'AUTH',
        status: 'SUCCESS',
        details: `Switched session context to ${targetUser.name} (${targetUser.role})`,
        ipAddress: req.ip || '127.0.0.1',
        timestamp: new Date().toISOString(),
      });

      res.json({
        message: `Switched to ${targetUser.name}`,
        token,
        user: sanitizeUser(targetUser),
        account,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Demo switch failed' });
    }
  });

  // Forgot Password (generate reset OTP)
  app.post('/api/auth/forgot-password', (req, res) => {
    try {
      const { email } = req.body;
      const user = DB.getUserByEmail(email);

      if (!user) {
        // Protect against email enumeration
        res.json({ message: 'If an account exists, a 6-digit reset code has been generated.', simulatedOTP: '749102' });
        return;
      }

      const otpCode = generateOTPCode();
      DB.createOTP({
        id: `otp_${Date.now()}`,
        userId: user.id,
        action: 'RESET_PASSWORD',
        otpCode,
        expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
      });

      res.json({
        message: `Verification OTP sent to ${user.email}`,
        simulatedOTP: otpCode, // Provided for instant testing in demo mode
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to request password reset' });
    }
  });

  // Reset Password
  app.post('/api/auth/reset-password', (req, res) => {
    try {
      const { email, otpCode, newPassword } = req.body;
      const user = DB.getUserByEmail(email);

      if (!user) {
        res.status(400).json({ error: 'Invalid reset request' });
        return;
      }

      const isValid = DB.verifyOTP(user.id, 'RESET_PASSWORD', otpCode);
      if (!isValid) {
        res.status(400).json({ error: 'Invalid or expired OTP verification code' });
        return;
      }

      DB.updateUser(user.id, {
        passwordHash: hashPassword(newPassword),
        isLocked: false,
        failedLoginAttempts: 0,
      });

      DB.createAuditLog({
        id: `aud_${Date.now()}`,
        userId: user.id,
        userEmail: user.email,
        action: 'PASSWORD_RESET',
        category: 'SECURITY',
        status: 'SUCCESS',
        details: 'Password was successfully reset via OTP verification',
        ipAddress: req.ip || '127.0.0.1',
        timestamp: new Date().toISOString(),
      });

      res.json({ message: 'Password reset successfully. You can now log in with your new password.' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to reset password' });
    }
  });

  // Get Current Authenticated User & Account
  app.get('/api/auth/me', authenticate, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const account = DB.getAccountByUserId(user.id);
    res.json({
      user: sanitizeUser(user),
      account,
    });
  });

  // Logout
  app.post('/api/auth/logout', authenticate, (req: AuthenticatedRequest, res) => {
    DB.createAuditLog({
      id: `aud_${Date.now()}`,
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: 'USER_LOGOUT',
      category: 'AUTH',
      status: 'SUCCESS',
      details: 'User logged out and session terminated',
      ipAddress: req.ip || '127.0.0.1',
      timestamp: new Date().toISOString(),
    });
    res.json({ message: 'Logged out successfully' });
  });

  // ==========================================
  // 2. ACCOUNT & PROFILE MANAGEMENT
  // ==========================================

  app.get('/api/account/details', authenticate, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const account = DB.getAccountByUserId(user.id);

    if (!account) {
      res.status(404).json({ error: 'Banking account not found for this user' });
      return;
    }

    const txns = DB.getTransactionsByUserId(user.id);
    const totalReceived = txns
      .filter(t => t.type === 'Credit' || (t.type === 'Transfer' && t.receiverAccountNumber === account.accountNumber))
      .reduce((sum, t) => sum + t.amount, 0);

    const totalSent = txns
      .filter(t => t.type === 'Debit' || t.type === 'Bill Payment' || (t.type === 'Transfer' && t.senderAccountNumber === account.accountNumber))
      .reduce((sum, t) => sum + t.amount, 0);

    res.json({
      user: sanitizeUser(user),
      account,
      metrics: {
        totalReceived,
        totalSent,
        transactionCount: txns.length,
      }
    });
  });

  // Update Profile Information (cannot modify balance or account number)
  app.put('/api/account/profile', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const { name, phone, address, city, state, pinCode, avatarUrl, themePreference, dob, gender, occupation } = req.body;

      const updated = DB.updateUser(user.id, {
        ...(name && { name: name.trim() }),
        ...(phone && { phone: phone.trim() }),
        ...(address !== undefined && { address: address.trim() }),
        ...(city !== undefined && { city: city.trim() }),
        ...(state !== undefined && { state: state.trim() }),
        ...(pinCode !== undefined && { pinCode: pinCode.trim() }),
        ...(dob !== undefined && { dob: dob.trim() }),
        ...(gender !== undefined && { gender: gender.trim() }),
        ...(occupation !== undefined && { occupation: occupation.trim() }),
        ...(avatarUrl && { avatarUrl: avatarUrl.trim() }),
        ...(themePreference && { themePreference }),
      });

      DB.createAuditLog({
        id: `aud_${Date.now()}`,
        userId: user.id,
        userEmail: user.email,
        action: 'PROFILE_UPDATED',
        category: 'AUTH',
        status: 'SUCCESS',
        details: 'User updated personal profile details',
        ipAddress: req.ip || '127.0.0.1',
        timestamp: new Date().toISOString(),
      });

      res.json({
        message: 'Profile updated successfully',
        user: sanitizeUser(updated!),
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update profile' });
    }
  });

  // KYC Submission Endpoint
  app.post('/api/kyc/submit', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const { aadhaarNumber, panNumber, documentType, documentNumber, aadhaarDocName, panDocName, addressProofDocName, selfieVerified } = req.body;

      const kycDetails = {
        aadhaarNumber: aadhaarNumber || user.kycDetails?.aadhaarNumber || 'XXXX-XXXX-4821',
        panNumber: (panNumber || user.kycDetails?.panNumber || 'ABCDE1234F').toUpperCase(),
        documentType: documentType || 'Aadhaar Card & PAN Card',
        documentNumber: documentNumber || aadhaarNumber || 'UIDAI-VERIFIED',
        aadhaarDocName: aadhaarDocName || 'Aadhaar_Document_Front_Back.pdf',
        panDocName: panDocName || 'PAN_Card_Scanned_Copy.pdf',
        addressProofDocName: addressProofDocName || 'Utility_Bill_Address_Proof.pdf',
        selfieVerified: selfieVerified !== undefined ? selfieVerified : true,
        submittedAt: new Date().toISOString(),
      };

      const updated = DB.updateUser(user.id, {
        kycStatus: 'Under Review',
        kycDetails,
      });

      DB.createNotification({
        id: `notif_${Date.now()}`,
        userId: user.id,
        title: 'KYC Documents Submitted for Verification',
        message: 'Your Aadhaar, PAN and identity proof documents have been submitted and are under review by the bank manager.',
        type: 'security',
        isRead: false,
        createdAt: new Date().toISOString(),
      });

      DB.createAuditLog({
        id: `aud_${Date.now()}`,
        userId: user.id,
        userEmail: user.email,
        action: 'KYC_SUBMITTED',
        category: 'AUTH',
        status: 'SUCCESS',
        details: `KYC verification documents submitted. Aadhaar: ${kycDetails.aadhaarNumber}, PAN: ${kycDetails.panNumber}`,
        ipAddress: req.ip || '127.0.0.1',
        timestamp: new Date().toISOString(),
      });

      res.json({
        message: 'KYC verification submitted successfully! Status is now Under Review.',
        user: sanitizeUser(updated!),
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to submit KYC verification' });
    }
  });

  // Nominee Details Update Endpoint
  app.post('/api/account/nominee', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const account = DB.getAccountByUserId(user.id);
      if (!account) {
        res.status(404).json({ error: 'Account not found' });
        return;
      }

      const { name, relationship, age, dob, address, phone, sharePercentage } = req.body;
      if (!name || !relationship) {
        res.status(400).json({ error: 'Nominee name and relationship are required' });
        return;
      }

      const nomineeData = {
        name: name.trim(),
        relationship: relationship.trim(),
        age: Number(age) || 30,
        dob: dob || '1995-05-15',
        address: address ? address.trim() : (user.address || 'Same as primary account holder'),
        phone: phone ? phone.trim() : user.phone,
        sharePercentage: Number(sharePercentage) || 100,
        registeredAt: new Date().toISOString(),
      };

      const updatedAccount = DB.updateAccount(account.id, { nominee: nomineeData });

      DB.createNotification({
        id: `notif_${Date.now()}`,
        userId: user.id,
        title: 'Nominee Details Updated',
        message: `${nomineeData.name} (${nomineeData.relationship}) is now registered as your account nominee with ${nomineeData.sharePercentage}% entitlement.`,
        type: 'system',
        isRead: false,
        createdAt: new Date().toISOString(),
      });

      res.json({
        message: 'Nominee registered successfully',
        account: updatedAccount,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update nominee details' });
    }
  });

  // Daily Limit Update Endpoint
  app.post('/api/account/limits', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const account = DB.getAccountByUserId(user.id);
      if (!account) {
        res.status(404).json({ error: 'Account not found' });
        return;
      }

      const { dailyTransferLimit, transactionPin } = req.body;
      const newLimit = Number(dailyTransferLimit);

      if (isNaN(newLimit) || newLimit < 5000 || newLimit > 1000000) {
        res.status(400).json({ error: 'Daily transfer limit must be between ₹5,000 and ₹10,00,000' });
        return;
      }

      if (transactionPin && !verifyPin(transactionPin, user.transactionPinHash)) {
        res.status(401).json({ error: 'Invalid 4-digit Transaction PIN' });
        return;
      }

      const updatedAccount = DB.updateAccount(account.id, { dailyTransferLimit: newLimit });

      res.json({
        message: `Daily transfer limit updated to ₹${newLimit.toLocaleString('en-IN')}`,
        account: updatedAccount,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update transfer limit' });
    }
  });

  // Quick Deposit Endpoint (For testing & balance addition)
  app.post('/api/account/deposit', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const account = DB.getAccountByUserId(user.id);
      if (!account) {
        res.status(404).json({ error: 'Account not found' });
        return;
      }

      const { amount, source } = req.body;
      const depositAmount = Number(amount);
      if (isNaN(depositAmount) || depositAmount <= 0) {
        res.status(400).json({ error: 'Valid deposit amount required' });
        return;
      }

      const newBalance = account.balance + depositAmount;
      const updatedAccount = DB.updateAccount(account.id, { balance: newBalance });

      const txnId = `TXN-DEP-${Math.floor(10000000 + Math.random() * 90000000)}`;
      const refId = `DEP-${Math.floor(100000 + Math.random() * 900000)}`;

      const txn: Transaction = {
        id: txnId,
        userId: user.id,
        accountNumber: account.accountNumber,
        senderName: source || 'Direct Bank Deposit / Salary Credit',
        senderAccountNumber: 'CLEARING-HOUSE-IN',
        receiverName: user.name,
        receiverAccountNumber: account.accountNumber,
        amount: depositAmount,
        type: 'Credit',
        category: 'Salary',
        description: `Funds Credited: ${source || 'UPI / Net Banking Cash Deposit'}`,
        status: 'completed',
        balanceAfter: newBalance,
        timestamp: new Date().toISOString(),
        referenceId: refId,
        channel: 'Web Banking',
      };
      DB.createTransaction(txn);

      DB.createNotification({
        id: `notif_${Date.now()}`,
        userId: user.id,
        title: 'Account Credited',
        message: `₹${depositAmount.toLocaleString('en-IN')} deposited into account ${account.accountNumber}. Available Balance: ₹${newBalance.toLocaleString('en-IN')}`,
        type: 'transfer_received',
        isRead: false,
        createdAt: new Date().toISOString(),
      });

      res.json({
        message: `₹${depositAmount.toLocaleString('en-IN')} deposited successfully!`,
        account: updatedAccount,
        transaction: txn,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to process deposit' });
    }
  });

  // Freeze / Unfreeze Account Toggle
  app.post('/api/account/freeze-toggle', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const { transactionPin, reason } = req.body;
      const account = DB.getAccountByUserId(user.id);

      if (!account) {
        res.status(404).json({ error: 'Account not found' });
        return;
      }

      if (transactionPin && !verifyPin(transactionPin, user.transactionPinHash)) {
        res.status(401).json({ error: 'Invalid 4-digit Transaction PIN' });
        return;
      }

      const newStatus = account.status === 'active' ? 'frozen' : 'active';
      const updatedAccount = DB.updateAccount(account.id, { status: newStatus });

      DB.createNotification({
        id: `notif_${Date.now()}`,
        userId: user.id,
        title: newStatus === 'frozen' ? 'Account Temporarily Frozen' : 'Account Reactivated',
        message: newStatus === 'frozen' 
          ? 'Your account has been frozen. Outgoing transfers and card charges are blocked.' 
          : 'Your account is now active and regular banking operations are enabled.',
        type: 'security',
        isRead: false,
        createdAt: new Date().toISOString(),
      });

      DB.createAuditLog({
        id: `aud_${Date.now()}`,
        userId: user.id,
        userEmail: user.email,
        action: newStatus === 'frozen' ? 'ACCOUNT_FROZEN' : 'ACCOUNT_UNFROZEN',
        category: 'SECURITY',
        status: 'SUCCESS',
        details: `Account status transitioned to ${newStatus}. Reason: ${reason || 'User requested in security panel'}`,
        ipAddress: req.ip || '127.0.0.1',
        timestamp: new Date().toISOString(),
      });

      res.json({
        message: `Account has been ${newStatus === 'frozen' ? 'frozen' : 'unfrozen'} successfully`,
        account: updatedAccount,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to change account status' });
    }
  });

  // Change Transaction PIN
  app.post('/api/account/change-pin', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const { currentPin, newPin } = req.body;

      if (!newPin || newPin.length !== 4 || isNaN(Number(newPin))) {
        res.status(400).json({ error: 'New PIN must be exactly 4 numeric digits' });
        return;
      }

      if (!verifyPin(currentPin, user.transactionPinHash)) {
        res.status(401).json({ error: 'Current Transaction PIN is incorrect' });
        return;
      }

      DB.updateUser(user.id, { transactionPinHash: hashPin(newPin) });

      DB.createNotification({
        id: `notif_${Date.now()}`,
        userId: user.id,
        title: 'Transaction PIN Changed',
        message: 'Your 4-digit Transaction Security PIN was changed successfully.',
        type: 'security',
        isRead: false,
        createdAt: new Date().toISOString(),
      });

      DB.createAuditLog({
        id: `aud_${Date.now()}`,
        userId: user.id,
        userEmail: user.email,
        action: 'PIN_CHANGED',
        category: 'SECURITY',
        status: 'SUCCESS',
        details: 'User updated transaction PIN',
        ipAddress: req.ip || '127.0.0.1',
        timestamp: new Date().toISOString(),
      });

      res.json({ message: 'Transaction PIN changed successfully' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to change PIN' });
    }
  });

  // Change Password
  app.post('/api/account/change-password', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const { currentPassword, newPassword } = req.body;

      if (!newPassword || newPassword.length < 6) {
        res.status(400).json({ error: 'New password must be at least 6 characters' });
        return;
      }

      if (!verifyPassword(currentPassword, user.passwordHash)) {
        res.status(401).json({ error: 'Current password is incorrect' });
        return;
      }

      DB.updateUser(user.id, { passwordHash: hashPassword(newPassword) });

      DB.createNotification({
        id: `notif_${Date.now()}`,
        userId: user.id,
        title: 'Password Changed',
        message: 'Your Apex Bank login password was updated successfully.',
        type: 'security',
        isRead: false,
        createdAt: new Date().toISOString(),
      });

      DB.createAuditLog({
        id: `aud_${Date.now()}`,
        userId: user.id,
        userEmail: user.email,
        action: 'PASSWORD_CHANGED',
        category: 'SECURITY',
        status: 'SUCCESS',
        details: 'User changed account password',
        ipAddress: req.ip || '127.0.0.1',
        timestamp: new Date().toISOString(),
      });

      res.json({ message: 'Password changed successfully' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update password' });
    }
  });

  // ==========================================
  // 3. MONEY TRANSFER SYSTEM
  // ==========================================

  // Recipient Account Lookup & Verification
  app.post('/api/transfers/verify-recipient', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const { accountNumber } = req.body;
      const cleanAcc = (accountNumber || '').trim().toUpperCase();

      if (!cleanAcc) {
        res.status(400).json({ error: 'Account number is required' });
        return;
      }

      if (cleanAcc === req.account?.accountNumber) {
        res.status(400).json({ error: 'Cannot transfer funds to your own account number' });
        return;
      }

      const targetAccount = DB.getAccountByNumber(cleanAcc);

      if (targetAccount) {
        const targetUser = DB.getUserById(targetAccount.userId);
        res.json({
          exists: true,
          isInternal: true,
          accountNumber: targetAccount.accountNumber,
          accountType: targetAccount.accountType,
          recipientName: targetUser?.name || 'Apex Account Holder',
          bankName: 'Apex Digital Bank',
          ifscCode: targetAccount.ifscCode,
          branchName: targetAccount.branchName,
          status: targetAccount.status,
        });
        return;
      }

      // External account simulation
      if (cleanAcc.length >= 9) {
        res.json({
          exists: true,
          isInternal: false,
          accountNumber: cleanAcc,
          recipientName: 'Verified External Beneficiary',
          bankName: cleanAcc.startsWith('HDFC') ? 'HDFC Bank Ltd' : cleanAcc.startsWith('ICIC') ? 'ICICI Bank' : 'Other Commercial Bank',
          ifscCode: 'RBIS0NEFT01',
          branchName: 'National Electronic Funds Clearing',
          status: 'active',
        });
        return;
      }

      res.status(404).json({ error: 'Account number not found or invalid format' });
    } catch (err) {
      res.status(500).json({ error: 'Error validating recipient account' });
    }
  });

  // Request Transfer OTP for 2-Factor / Suspicious Check
  app.post('/api/transfers/request-otp', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const { amount, receiverAccountNumber } = req.body;
      const account = DB.getAccountByUserId(user.id);

      if (!account) {
        res.status(404).json({ error: 'Account not found' });
        return;
      }

      const riskAssessment = evaluateTransactionRisk(user, account, Number(amount) || 0, receiverAccountNumber);

      const otpCode = generateOTPCode();
      DB.createOTP({
        id: `otp_${Date.now()}`,
        userId: user.id,
        action: 'TRANSFER',
        otpCode,
        expiresAt: Date.now() + 5 * 60 * 1000,
        payload: { amount, receiverAccountNumber },
      });

      res.json({
        requiresOTP: riskAssessment.requiresOTP,
        isSuspicious: riskAssessment.isSuspicious,
        suspicionReason: riskAssessment.reason,
        simulatedOTP: otpCode, // Displayed in toast/demo modal for instant testing
        message: riskAssessment.isSuspicious
          ? 'Suspicious transaction pattern detected. High-security 2FA OTP has been issued.'
          : 'Transfer 2FA OTP code generated.',
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to generate transfer OTP' });
    }
  });

  // Execute Transfer (Atomic Balance Update & Isolation)
  app.post('/api/transfers/send', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const sender = req.user!;
      const senderAccount = DB.getAccountByUserId(sender.id);
      const { receiverAccountNumber, amount, description, category, transactionPin, otpCode } = req.body;

      if (!senderAccount) {
        res.status(404).json({ error: 'Sender banking account not found' });
        return;
      }

      if (senderAccount.status === 'frozen') {
        res.status(403).json({ error: 'Your account is currently frozen. Transfers are blocked.' });
        return;
      }

      const transferAmount = Number(amount);
      if (isNaN(transferAmount) || transferAmount <= 0) {
        res.status(400).json({ error: 'Please specify a valid transfer amount greater than ₹0' });
        return;
      }

      if (transferAmount > senderAccount.balance) {
        res.status(400).json({
          error: `Insufficient balance. Available: ₹${senderAccount.balance.toLocaleString('en-IN')}, Requested: ₹${transferAmount.toLocaleString('en-IN')}`,
        });
        return;
      }

      if (transferAmount > senderAccount.dailyTransferLimit) {
        res.status(400).json({
          error: `Transfer exceeds daily limit of ₹${senderAccount.dailyTransferLimit.toLocaleString('en-IN')}`,
        });
        return;
      }

      // Verify PIN
      if (!transactionPin || !verifyPin(transactionPin, sender.transactionPinHash)) {
        res.status(401).json({ error: 'Invalid 4-digit Transaction Security PIN' });
        return;
      }

      const cleanReceiverAcc = (receiverAccountNumber || '').trim().toUpperCase();
      if (cleanReceiverAcc === senderAccount.accountNumber) {
        res.status(400).json({ error: 'Cannot transfer funds to the same account' });
        return;
      }

      // Risk Evaluation
      const risk = evaluateTransactionRisk(sender, senderAccount, transferAmount, cleanReceiverAcc);

      // Verify OTP if required
      if (risk.requiresOTP) {
        if (!otpCode) {
          res.status(400).json({ error: 'OTP verification code is required for this transaction', requiresOTP: true });
          return;
        }
        const isOtpValid = DB.verifyOTP(sender.id, 'TRANSFER', otpCode);
        if (!isOtpValid) {
          res.status(400).json({ error: 'Invalid or expired OTP verification code' });
          return;
        }
      }

      const receiverAccount = DB.getAccountByNumber(cleanReceiverAcc);
      let receiverUser: User | undefined;
      let receiverDisplayName = cleanReceiverAcc;

      if (receiverAccount) {
        receiverUser = DB.getUserById(receiverAccount.userId);
        receiverDisplayName = receiverUser?.name || 'Apex Account Holder';

        if (receiverAccount.status === 'frozen') {
          res.status(400).json({ error: 'Receiver account is currently frozen and cannot receive incoming funds' });
          return;
        }
      }

      // Atomic Balance Mutation
      const newSenderBalance = senderAccount.balance - transferAmount;
      DB.updateAccount(senderAccount.id, { balance: newSenderBalance });

      let newReceiverBalance: number | undefined;
      if (receiverAccount) {
        newReceiverBalance = receiverAccount.balance + transferAmount;
        DB.updateAccount(receiverAccount.id, { balance: newReceiverBalance });
      }

      const txnTimestamp = new Date().toISOString();
      const referenceId = `REF-${Math.floor(100000 + Math.random() * 900000)}`;
      const senderTxnId = `TXN-${Math.floor(10000000 + Math.random() * 90000000)}`;

      // 1. Record Debit Transaction for Sender
      const senderTxn: Transaction = {
        id: senderTxnId,
        userId: sender.id,
        accountNumber: senderAccount.accountNumber,
        senderName: sender.name,
        senderAccountNumber: senderAccount.accountNumber,
        receiverName: receiverDisplayName,
        receiverAccountNumber: cleanReceiverAcc,
        amount: transferAmount,
        type: 'Transfer',
        category: (category as any) || 'Transfer',
        description: description || `Transfer to ${receiverDisplayName}`,
        status: 'completed',
        balanceAfter: newSenderBalance,
        timestamp: txnTimestamp,
        referenceId,
        isSuspicious: risk.isSuspicious,
        suspicionReason: risk.reason,
        channel: 'Web Banking',
      };
      DB.createTransaction(senderTxn);

      // 2. Sender Notification
      DB.createNotification({
        id: `notif_${Date.now()}`,
        userId: sender.id,
        title: 'Money Sent Successfully',
        message: `₹${transferAmount.toLocaleString('en-IN')} sent to ${receiverDisplayName} (${cleanReceiverAcc}). Ref: ${referenceId}`,
        type: 'transfer_sent',
        isRead: false,
        createdAt: txnTimestamp,
      });

      // 3. Record Credit Transaction & Notification for Receiver (if internal user)
      if (receiverAccount && receiverUser) {
        const receiverTxnId = `TXN-${Math.floor(10000000 + Math.random() * 90000000)}`;
        const receiverTxn: Transaction = {
          id: receiverTxnId,
          userId: receiverUser.id,
          accountNumber: receiverAccount.accountNumber,
          senderName: sender.name,
          senderAccountNumber: senderAccount.accountNumber,
          receiverName: receiverUser.name,
          receiverAccountNumber: receiverAccount.accountNumber,
          amount: transferAmount,
          type: 'Credit',
          category: 'Transfer',
          description: description || `Funds received from ${sender.name}`,
          status: 'completed',
          balanceAfter: newReceiverBalance!,
          timestamp: txnTimestamp,
          referenceId,
          channel: 'Web Banking',
        };
        DB.createTransaction(receiverTxn);

        DB.createNotification({
          id: `notif_${Date.now() + 1}`,
          userId: receiverUser.id,
          title: 'Money Received',
          message: `₹${transferAmount.toLocaleString('en-IN')} received from ${sender.name} (${senderAccount.accountNumber}). Ref: ${referenceId}`,
          type: 'transfer_received',
          isRead: false,
          createdAt: txnTimestamp,
        });
      }

      // 4. Audit Log
      DB.createAuditLog({
        id: `aud_${Date.now()}`,
        userId: sender.id,
        userEmail: sender.email,
        action: 'FUNDS_TRANSFER',
        category: 'TRANSFER',
        status: 'SUCCESS',
        details: `Transferred ₹${transferAmount} to ${cleanReceiverAcc} (${receiverDisplayName})`,
        referenceId,
        ipAddress: req.ip || '127.0.0.1',
        timestamp: txnTimestamp,
      });

      res.status(200).json({
        success: true,
        message: `₹${transferAmount.toLocaleString('en-IN')} transferred successfully to ${receiverDisplayName}`,
        transaction: senderTxn,
        newBalance: newSenderBalance,
        referenceId,
      });
    } catch (err: any) {
      console.error('Transfer execution error:', err);
      res.status(500).json({ error: 'Failed to process money transfer' });
    }
  });

  // ==========================================
  // 4. BENEFICIARIES MANAGEMENT
  // ==========================================

  app.get('/api/beneficiaries', authenticate, (req: AuthenticatedRequest, res) => {
    const list = DB.getBeneficiariesByUserId(req.user!.id);
    res.json({ beneficiaries: list });
  });

  app.post('/api/beneficiaries', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const { beneficiaryName, accountNumber, bankName, ifscCode, nickname, maxLimit } = req.body;

      if (!beneficiaryName || !accountNumber) {
        res.status(400).json({ error: 'Beneficiary name and account number are required' });
        return;
      }

      const cleanAcc = accountNumber.trim().toUpperCase();
      const internalAcc = DB.getAccountByNumber(cleanAcc);

      const newBen: Beneficiary = {
        id: `ben_${Date.now()}`,
        userId: user.id,
        beneficiaryName: beneficiaryName.trim(),
        accountNumber: cleanAcc,
        bankName: internalAcc ? 'Apex Digital Bank' : (bankName || 'Other Bank'),
        ifscCode: internalAcc ? internalAcc.ifscCode : (ifscCode || 'APEX0000000'),
        nickname: nickname?.trim(),
        maxLimit: Number(maxLimit) || 100000,
        isVerified: !!internalAcc || cleanAcc.length >= 8,
        createdAt: new Date().toISOString(),
      };

      DB.createBeneficiary(newBen);

      DB.createAuditLog({
        id: `aud_${Date.now()}`,
        userId: user.id,
        userEmail: user.email,
        action: 'BENEFICIARY_ADDED',
        category: 'BENEFICIARY',
        status: 'SUCCESS',
        details: `Added beneficiary ${newBen.beneficiaryName} (${cleanAcc})`,
        referenceId: newBen.id,
        ipAddress: req.ip || '127.0.0.1',
        timestamp: new Date().toISOString(),
      });

      res.status(201).json({ message: 'Beneficiary added successfully', beneficiary: newBen });
    } catch (err) {
      res.status(500).json({ error: 'Failed to add beneficiary' });
    }
  });

  app.delete('/api/beneficiaries/:id', authenticate, (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const deleted = DB.deleteBeneficiary(id, req.user!.id);
    if (!deleted) {
      res.status(404).json({ error: 'Beneficiary not found' });
      return;
    }
    DB.createAuditLog({
      id: `aud_${Date.now()}`,
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: 'BENEFICIARY_REMOVED',
      category: 'BENEFICIARY',
      status: 'SUCCESS',
      details: `Removed beneficiary ID ${id}`,
      referenceId: id,
      ipAddress: req.ip || '127.0.0.1',
      timestamp: new Date().toISOString(),
    });
    res.json({ message: 'Beneficiary deleted successfully' });
  });

  // ==========================================
  // 5. TRANSACTIONS & STATEMENT
  // ==========================================

  app.get('/api/transactions', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      let txns = DB.getTransactionsByUserId(user.id);

      const { search, category, type, status, startDate, endDate, minAmount, maxAmount, page, limit } = req.query;

      if (search) {
        const q = String(search).toLowerCase();
        txns = txns.filter(t =>
          t.description.toLowerCase().includes(q) ||
          t.senderName.toLowerCase().includes(q) ||
          t.receiverName.toLowerCase().includes(q) ||
          t.referenceId.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q)
        );
      }

      if (category && category !== 'All') {
        txns = txns.filter(t => t.category === category);
      }

      if (type && type !== 'All') {
        txns = txns.filter(t => t.type === type);
      }

      if (status && status !== 'All') {
        txns = txns.filter(t => t.status === status);
      }

      if (startDate) {
        txns = txns.filter(t => new Date(t.timestamp) >= new Date(String(startDate)));
      }

      if (endDate) {
        txns = txns.filter(t => new Date(t.timestamp) <= new Date(String(endDate) + 'T23:59:59.999Z'));
      }

      if (minAmount) {
        txns = txns.filter(t => t.amount >= Number(minAmount));
      }

      if (maxAmount) {
        txns = txns.filter(t => t.amount <= Number(maxAmount));
      }

      const totalItems = txns.length;
      const p = Math.max(1, Number(page) || 1);
      const l = Math.min(100, Math.max(1, Number(limit) || 10));
      const paginatedTxns = txns.slice((p - 1) * l, p * l);

      res.json({
        transactions: paginatedTxns,
        totalItems,
        page: p,
        totalPages: Math.ceil(totalItems / l),
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch transactions' });
    }
  });

  // Statement Summary for PDF download and range
  app.get('/api/statement/summary', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const account = DB.getAccountByUserId(user.id);
      const txns = DB.getTransactionsByUserId(user.id);

      const totalCredits = txns
        .filter(t => t.type === 'Credit' || (t.type === 'Transfer' && t.receiverAccountNumber === account?.accountNumber))
        .reduce((sum, t) => sum + t.amount, 0);

      const totalDebits = txns
        .filter(t => t.type === 'Debit' || t.type === 'Bill Payment' || (t.type === 'Transfer' && t.senderAccountNumber === account?.accountNumber))
        .reduce((sum, t) => sum + t.amount, 0);

      res.json({
        customerName: user.name,
        customerNumber: user.customerNumber,
        accountNumber: account?.accountNumber,
        accountType: account?.accountType,
        ifscCode: account?.ifscCode,
        branchName: account?.branchName,
        currentBalance: account?.balance || 0,
        totalCredits,
        totalDebits,
        statementDate: new Date().toISOString(),
        transactions: txns,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to generate statement summary' });
    }
  });

  // ==========================================
  // 6. SMART EXPENSE ANALYTICS & INSIGHTS
  // ==========================================

  app.get('/api/analytics/overview', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const account = DB.getAccountByUserId(user.id);
      const txns = DB.getTransactionsByUserId(user.id);

      // Category-wise spending
      const categoryMap: Record<string, number> = {
        Food: 0,
        Shopping: 0,
        Bills: 0,
        Travel: 0,
        Entertainment: 0,
        Education: 0,
        Healthcare: 0,
        Transfer: 0,
        Other: 0,
      };

      let totalExpenses = 0;
      let totalIncome = 0;

      txns.forEach(t => {
        if (t.type === 'Debit' || t.type === 'Bill Payment' || (t.type === 'Transfer' && t.senderAccountNumber === account?.accountNumber)) {
          const cat = t.category in categoryMap ? t.category : 'Other';
          categoryMap[cat] = (categoryMap[cat] || 0) + t.amount;
          totalExpenses += t.amount;
        } else if (t.type === 'Credit' || t.type === 'Deposit' || (t.type === 'Transfer' && t.receiverAccountNumber === account?.accountNumber)) {
          totalIncome += t.amount;
        }
      });

      // Find highest category
      let highestCategory = 'None';
      let highestCategoryAmount = 0;
      Object.entries(categoryMap).forEach(([cat, amt]) => {
        if (amt > highestCategoryAmount) {
          highestCategoryAmount = amt;
          highestCategory = cat;
        }
      });

      // Monthly Trend (Simulated last 6 months data combined with real txns)
      const monthlyData = [
        { month: 'Mar', income: 85000, expense: 42000 },
        { month: 'Apr', income: 85000, expense: 48500 },
        { month: 'May', income: 90000, expense: 53000 },
        { month: 'Jun', income: 90000, expense: 47800 },
        { month: 'Jul', income: 95000, expense: 51200 },
        { month: 'Aug', income: totalIncome || 95000, expense: totalExpenses || 34800 },
      ];

      // Smart Rule-Based Financial Insights
      const insights: Array<{ id: string; type: 'info' | 'warning' | 'success' | 'tip'; title: string; text: string; icon: string }> = [];

      if (highestCategory !== 'None' && totalExpenses > 0) {
        const pct = Math.round((highestCategoryAmount / totalExpenses) * 100);
        insights.push({
          id: 'ins_1',
          type: 'info',
          title: 'Top Expenditure Sector',
          text: `${highestCategory} represents ${pct}% of your total outgoing spending this cycle (₹${highestCategoryAmount.toLocaleString('en-IN')}).`,
          icon: 'PieChart',
        });
      }

      if (totalIncome > totalExpenses) {
        const netSavings = totalIncome - totalExpenses;
        insights.push({
          id: 'ins_2',
          type: 'success',
          title: 'Positive Cash Flow',
          text: `You have a positive net surplus of ₹${netSavings.toLocaleString('en-IN')} this month. Consider allocating a portion to your savings goals.`,
          icon: 'TrendingUp',
        });
      }

      const goals = DB.getSavingsGoalsByUserId(user.id);
      const closeGoal = goals.find(g => (g.savedAmount / g.targetAmount) >= 0.7 && g.savedAmount < g.targetAmount);
      if (closeGoal) {
        const pct = Math.round((closeGoal.savedAmount / closeGoal.targetAmount) * 100);
        insights.push({
          id: 'ins_3',
          type: 'tip',
          title: 'Goal Nearing Completion',
          text: `You have achieved ${pct}% of your "${closeGoal.title}" target. Only ₹${(closeGoal.targetAmount - closeGoal.savedAmount).toLocaleString('en-IN')} remaining!`,
          icon: 'Target',
        });
      }

      if (account && account.balance < 20000) {
        insights.push({
          id: 'ins_4',
          type: 'warning',
          title: 'Low Balance Cushion',
          text: `Your available balance (₹${account.balance.toLocaleString('en-IN')}) is running lower than recommended for regular recurring obligations.`,
          icon: 'AlertTriangle',
        });
      }

      res.json({
        totalIncome,
        totalExpenses,
        netCashFlow: totalIncome - totalExpenses,
        highestCategory,
        highestCategoryAmount,
        categoryBreakdown: Object.entries(categoryMap).map(([category, amount]) => ({
          category,
          amount,
          percentage: totalExpenses > 0 ? Math.round((amount / totalExpenses) * 100) : 0,
        })),
        monthlyTrends: monthlyData,
        insights,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to calculate analytics' });
    }
  });

  // ==========================================
  // 7. SAVINGS GOALS
  // ==========================================

  app.get('/api/goals', authenticate, (req: AuthenticatedRequest, res) => {
    const goals = DB.getSavingsGoalsByUserId(req.user!.id);
    res.json({ goals });
  });

  app.post('/api/goals', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const { title, targetAmount, targetDate, category, icon, color } = req.body;

      if (!title || !targetAmount) {
        res.status(400).json({ error: 'Goal title and target amount are required' });
        return;
      }

      const newGoal: SavingsGoal = {
        id: `goal_${Date.now()}`,
        userId: user.id,
        title: title.trim(),
        targetAmount: Number(targetAmount),
        savedAmount: 0,
        targetDate: targetDate || new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        category: category || 'General',
        icon: icon || 'Target',
        color: color || '#3B82F6',
        createdAt: new Date().toISOString(),
      };

      DB.createSavingsGoal(newGoal);
      res.status(201).json({ message: 'Savings goal created', goal: newGoal });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create goal' });
    }
  });

  app.post('/api/goals/:id/deposit', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const account = DB.getAccountByUserId(user.id);
      const { id } = req.params;
      const { amount } = req.body;
      const depAmount = Number(amount);

      if (!account || isNaN(depAmount) || depAmount <= 0) {
        res.status(400).json({ error: 'Valid deposit amount is required' });
        return;
      }

      if (depAmount > account.balance) {
        res.status(400).json({ error: 'Insufficient balance to add funds to goal' });
        return;
      }

      const goal = DB.getSavingsGoalById(id, user.id);
      if (!goal) {
        res.status(404).json({ error: 'Savings goal not found' });
        return;
      }

      // Deduct from account balance and add to goal
      const newBalance = account.balance - depAmount;
      const newSaved = goal.savedAmount + depAmount;

      DB.updateAccount(account.id, { balance: newBalance });
      const updatedGoal = DB.updateSavingsGoal(id, user.id, { savedAmount: newSaved });

      DB.createTransaction({
        id: `TXN-GOL-${Date.now().toString().slice(-6)}`,
        userId: user.id,
        accountNumber: account.accountNumber,
        senderName: user.name,
        senderAccountNumber: account.accountNumber,
        receiverName: `Savings Vault: ${goal.title}`,
        receiverAccountNumber: `VAULT-${goal.id.slice(-6)}`,
        amount: depAmount,
        type: 'Transfer',
        category: 'Other',
        description: `Allocated funds to savings goal: ${goal.title}`,
        status: 'completed',
        balanceAfter: newBalance,
        timestamp: new Date().toISOString(),
        referenceId: `GOL-${Date.now().toString().slice(-6)}`,
        channel: 'Web Banking',
      });

      res.json({
        message: `₹${depAmount.toLocaleString('en-IN')} added to "${goal.title}"`,
        goal: updatedGoal,
        accountBalance: newBalance,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to deposit to savings goal' });
    }
  });

  app.post('/api/goals/:id/withdraw', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const account = DB.getAccountByUserId(user.id);
      const { id } = req.params;
      const { amount } = req.body;
      const withAmount = Number(amount);

      const goal = DB.getSavingsGoalById(id, user.id);
      if (!goal || !account) {
        res.status(404).json({ error: 'Goal or account not found' });
        return;
      }

      if (isNaN(withAmount) || withAmount <= 0 || withAmount > goal.savedAmount) {
        res.status(400).json({ error: 'Withdrawal amount exceeds saved goal balance' });
        return;
      }

      const newBalance = account.balance + withAmount;
      const newSaved = goal.savedAmount - withAmount;

      DB.updateAccount(account.id, { balance: newBalance });
      const updatedGoal = DB.updateSavingsGoal(id, user.id, { savedAmount: newSaved });

      DB.createTransaction({
        id: `TXN-WTH-${Date.now().toString().slice(-6)}`,
        userId: user.id,
        accountNumber: account.accountNumber,
        senderName: `Savings Vault: ${goal.title}`,
        senderAccountNumber: `VAULT-${goal.id.slice(-6)}`,
        receiverName: user.name,
        receiverAccountNumber: account.accountNumber,
        amount: withAmount,
        type: 'Deposit',
        category: 'Other',
        description: `Withdrew funds from savings goal: ${goal.title}`,
        status: 'completed',
        balanceAfter: newBalance,
        timestamp: new Date().toISOString(),
        referenceId: `WTH-${Date.now().toString().slice(-6)}`,
        channel: 'Web Banking',
      });

      res.json({
        message: `₹${withAmount.toLocaleString('en-IN')} withdrawn back to main balance`,
        goal: updatedGoal,
        accountBalance: newBalance,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to withdraw from goal' });
    }
  });

  app.delete('/api/goals/:id', authenticate, (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const deleted = DB.deleteSavingsGoal(id, req.user!.id);
    if (!deleted) {
      res.status(404).json({ error: 'Savings goal not found' });
      return;
    }
    res.json({ message: 'Savings goal removed' });
  });

  // ==========================================
  // 8. VIRTUAL DEBIT CARDS
  // ==========================================

  app.get('/api/card', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      let card = DB.getVirtualCardByUserId(user.id);
      if (!card) {
        card = DB.updateVirtualCard(user.id, {});
      }
      res.json({ card });
    } catch (err) {
      res.status(500).json({ error: 'Failed to retrieve or generate virtual card' });
    }
  });

  app.post('/api/card/freeze-toggle', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      let card = DB.getVirtualCardByUserId(user.id);
      if (!card) {
        card = DB.updateVirtualCard(user.id, {});
      }

      const newFrozenState = !card.isFrozen;
      const updated = DB.updateVirtualCard(user.id, { isFrozen: newFrozenState });

      DB.createNotification({
        id: `notif_${Date.now()}`,
        userId: user.id,
        title: newFrozenState ? 'Virtual Card Frozen' : 'Virtual Card Unfrozen',
        message: newFrozenState 
          ? 'Your virtual debit card has been temporarily frozen. E-commerce and POS transactions are paused.'
          : 'Your virtual debit card is now active for online and merchant transactions.',
        type: 'card_action',
        isRead: false,
        createdAt: new Date().toISOString(),
      });

      DB.createAuditLog({
        id: `aud_${Date.now()}`,
        userId: user.id,
        userEmail: user.email,
        action: newFrozenState ? 'CARD_FROZEN' : 'CARD_UNFROZEN',
        category: 'CARD',
        status: 'SUCCESS',
        details: `Virtual debit card status updated to ${newFrozenState ? 'Frozen' : 'Active'}`,
        ipAddress: req.ip || '127.0.0.1',
        timestamp: new Date().toISOString(),
      });

      res.json({ message: `Card ${newFrozenState ? 'frozen' : 'unfrozen'} successfully`, card: updated });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update card status' });
    }
  });

  app.put('/api/card/settings', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const { dailyOnlineLimit, onlineLimit, internationalEnabled, contactlessEnabled, isFrozen } = req.body;
      const limitVal = dailyOnlineLimit !== undefined ? dailyOnlineLimit : onlineLimit;

      const updated = DB.updateVirtualCard(user.id, {
        ...(limitVal !== undefined && { dailyOnlineLimit: Number(limitVal) }),
        ...(internationalEnabled !== undefined && { internationalEnabled: Boolean(internationalEnabled) }),
        ...(contactlessEnabled !== undefined && { contactlessEnabled: Boolean(contactlessEnabled) }),
        ...(isFrozen !== undefined && { isFrozen: Boolean(isFrozen) }),
      });

      res.json({ message: 'Card controls updated', card: updated });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update card settings' });
    }
  });

  app.post('/api/card/regenerate', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const randomCardNum = `4532${Math.floor(100000000000 + Math.random() * 900000000000)}`;
      const newCvv = Math.floor(100 + Math.random() * 900).toString();

      const updated = DB.updateVirtualCard(user.id, {
        cardNumber: randomCardNum,
        cvv: newCvv,
        expiryDate: '12/30',
        isFrozen: false,
      });

      DB.createAuditLog({
        id: `aud_${Date.now()}`,
        userId: user.id,
        userEmail: user.email,
        action: 'CARD_REGENERATED',
        category: 'CARD',
        status: 'SUCCESS',
        details: 'User issued new virtual card details',
        ipAddress: req.ip || '127.0.0.1',
        timestamp: new Date().toISOString(),
      });

      res.json({ message: 'New virtual card credentials issued successfully', card: updated });
    } catch (err) {
      res.status(500).json({ error: 'Failed to regenerate card' });
    }
  });

  // ==========================================
  // 9. SCHEDULED TRANSFERS
  // ==========================================

  app.get('/api/scheduled', authenticate, (req: AuthenticatedRequest, res) => {
    const list = DB.getScheduledTransfersByUserId(req.user!.id);
    res.json({ scheduled: list });
  });

  app.post('/api/scheduled', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const { beneficiaryName, receiverAccountNumber, amount, frequency, executionDate, category, description } = req.body;

      if (!receiverAccountNumber || !amount || !executionDate) {
        res.status(400).json({ error: 'Beneficiary account, amount and execution date are required' });
        return;
      }

      const item: ScheduledTransfer = {
        id: `sch_${Date.now()}`,
        userId: user.id,
        beneficiaryName: beneficiaryName || receiverAccountNumber,
        receiverAccountNumber: receiverAccountNumber.trim().toUpperCase(),
        amount: Number(amount),
        frequency: frequency || 'Monthly',
        executionDate,
        category: (category as any) || 'Transfer',
        description: description || `Scheduled transfer to ${beneficiaryName || receiverAccountNumber}`,
        status: 'active',
        nextRunDate: executionDate,
        createdAt: new Date().toISOString(),
      };

      DB.createScheduledTransfer(item);

      DB.createNotification({
        id: `notif_${Date.now()}`,
        userId: user.id,
        title: 'Auto-Pay Scheduled',
        message: `Scheduled ${item.frequency} transfer of ₹${item.amount.toLocaleString('en-IN')} to ${item.beneficiaryName}. Next execution: ${item.nextRunDate}.`,
        type: 'scheduled_payment',
        isRead: false,
        createdAt: new Date().toISOString(),
      });

      res.status(201).json({ message: 'Scheduled transfer created', scheduled: item });
    } catch (err) {
      res.status(500).json({ error: 'Failed to schedule transfer' });
    }
  });

  app.delete('/api/scheduled/:id', authenticate, (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const deleted = DB.deleteScheduledTransfer(id, req.user!.id);
    if (!deleted) {
      res.status(404).json({ error: 'Scheduled payment not found' });
      return;
    }
    res.json({ message: 'Scheduled payment cancelled' });
  });

  // ==========================================
  // 10. BILL PAYMENTS
  // ==========================================

  app.get('/api/bills/providers', (req, res) => {
    res.json({
      Electricity: ['Tata Power DDL', 'BSES Rajdhani', 'BESCOM Bengaluru', 'MSEDCL Maharashtra', 'Adani Electricity Mumbai'],
      'Mobile recharge': ['Jio Prepaid/Postpaid', 'Airtel India', 'Vodafone Idea (Vi)', 'BSNL Mobile'],
      Internet: ['Airtel Xstream Fiber', 'JioFiber Broadband', 'ACT Fibernet', 'Tata Play Fiber'],
      Water: ['Delhi Jal Board (DJB)', 'BWSSB Bengaluru', 'MCGM Mumbai Water Board', 'Hyderabad HMWSSB'],
      DTH: ['Tata Play DTH', 'Airtel Digital TV', 'Dish TV India', 'Sun Direct DTH'],
      'Piped Gas': ['Indraprastha Gas (IGL)', 'Mahanagar Gas (MGL)', 'Adani Total Gas', 'Gujarat Gas Ltd'],
    });
  });

  app.get('/api/bills/history', authenticate, (req: AuthenticatedRequest, res) => {
    const list = DB.getBillPaymentsByUserId(req.user!.id);
    res.json({ bills: list });
  });

  app.post('/api/bills/pay', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const account = DB.getAccountByUserId(user.id);
      const { category, providerName, consumerNumber, amount, transactionPin } = req.body;

      if (!account) {
        res.status(404).json({ error: 'Account not found' });
        return;
      }

      if (account.status === 'frozen') {
        res.status(403).json({ error: 'Your account is frozen. Bill payments cannot be processed.' });
        return;
      }

      const billAmount = Number(amount);
      if (isNaN(billAmount) || billAmount <= 0) {
        res.status(400).json({ error: 'Valid bill amount is required' });
        return;
      }

      if (billAmount > account.balance) {
        res.status(400).json({ error: 'Insufficient balance to pay this bill' });
        return;
      }

      if (!transactionPin || !verifyPin(transactionPin, user.transactionPinHash)) {
        res.status(401).json({ error: 'Invalid 4-digit Transaction Security PIN' });
        return;
      }

      const newBalance = account.balance - billAmount;
      DB.updateAccount(account.id, { balance: newBalance });

      const txnId = `TXN-BIL-${Math.floor(10000000 + Math.random() * 90000000)}`;
      const refId = `BIL-${Math.floor(100000 + Math.random() * 900000)}`;

      // 1. Transaction record
      const txn: Transaction = {
        id: txnId,
        userId: user.id,
        accountNumber: account.accountNumber,
        senderName: user.name,
        senderAccountNumber: account.accountNumber,
        receiverName: `${providerName} (${category})`,
        receiverAccountNumber: `MERCH-BIL-${consumerNumber.slice(-4)}`,
        amount: billAmount,
        type: 'Bill Payment',
        category: 'Bills',
        description: `${category} Bill Payment: ${providerName} - Ref: ${consumerNumber}`,
        status: 'completed',
        balanceAfter: newBalance,
        timestamp: new Date().toISOString(),
        referenceId: refId,
        channel: 'Web Banking',
      };
      DB.createTransaction(txn);

      // 2. Bill Payment entry
      const bill: BillPayment = {
        id: `bill_${Date.now()}`,
        userId: user.id,
        category: category || 'Electricity',
        providerName,
        consumerNumber,
        amount: billAmount,
        transactionId: txnId,
        status: 'Paid',
        paidAt: new Date().toISOString(),
      };
      DB.createBillPayment(bill);

      // 3. Notification
      DB.createNotification({
        id: `notif_${Date.now()}`,
        userId: user.id,
        title: 'Bill Payment Successful',
        message: `₹${billAmount.toLocaleString('en-IN')} paid for ${providerName} (${consumerNumber}). Ref: ${refId}`,
        type: 'bill_payment',
        isRead: false,
        createdAt: new Date().toISOString(),
      });

      // 4. Audit Log
      DB.createAuditLog({
        id: `aud_${Date.now()}`,
        userId: user.id,
        userEmail: user.email,
        action: 'BILL_PAYMENT',
        category: 'BILL',
        status: 'SUCCESS',
        details: `Paid ₹${billAmount} for ${category} (${providerName})`,
        referenceId: refId,
        ipAddress: req.ip || '127.0.0.1',
        timestamp: new Date().toISOString(),
      });

      res.json({
        message: 'Bill payment processed successfully',
        bill,
        transaction: txn,
        newBalance,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to process bill payment' });
    }
  });

  // ==========================================
  // 11. NOTIFICATIONS & SECURITY ACTIVITIES
  // ==========================================

  app.get('/api/notifications', authenticate, (req: AuthenticatedRequest, res) => {
    const list = DB.getNotificationsByUserId(req.user!.id);
    const unreadCount = list.filter(n => !n.isRead).length;
    res.json({ notifications: list, unreadCount });
  });

  app.post('/api/notifications/:id/read', authenticate, (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    DB.markNotificationAsRead(id, req.user!.id);
    res.json({ success: true });
  });

  app.post('/api/notifications/read-all', authenticate, (req: AuthenticatedRequest, res) => {
    DB.markAllNotificationsAsRead(req.user!.id);
    res.json({ success: true });
  });

  app.delete('/api/notifications/:id', authenticate, (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    DB.deleteNotification(id, req.user!.id);
    res.json({ success: true });
  });

  app.get('/api/security/activities', authenticate, (req: AuthenticatedRequest, res) => {
    const activities = DB.getLoginActivitiesByUserId(req.user!.id);
    res.json({ activities });
  });

  // ==========================================
  // 12. ADMIN CONSOLE ROUTES (Role Protected)
  // ==========================================

  app.get('/api/admin/metrics', authenticate, requireAdmin, (req, res) => {
    const stats = DB.getStats();
    res.json({ metrics: stats });
  });

  app.get('/api/admin/users', authenticate, requireAdmin, (req, res) => {
    const allUsers = DB.getAllUsers();
    const allAccounts = DB.getAllAccounts();

    const usersWithAccounts = allUsers.map(u => {
      const userAcc = allAccounts.find(a => a.userId === u.id);
      return {
        ...sanitizeUser(u),
        account: userAcc,
      };
    });

    res.json({ users: usersWithAccounts });
  });

  app.post('/api/admin/users/:id/toggle-lock', authenticate, requireAdmin, (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const user = DB.getUserById(id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const newLocked = !user.isLocked;
    const updated = DB.updateUser(id, {
      isLocked: newLocked,
      failedLoginAttempts: newLocked ? user.failedLoginAttempts : 0,
    });

    DB.createAuditLog({
      id: `aud_${Date.now()}`,
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: newLocked ? 'ADMIN_LOCK_USER' : 'ADMIN_UNLOCK_USER',
      category: 'ADMIN',
      status: 'SUCCESS',
      details: `Admin ${req.user!.name} set lock state to ${newLocked} for user ${user.email}`,
      referenceId: user.customerNumber,
      ipAddress: req.ip || '127.0.0.1',
      timestamp: new Date().toISOString(),
    });

    res.json({ message: `User account has been ${newLocked ? 'locked' : 'unlocked'}`, user: sanitizeUser(updated!) });
  });

  app.post('/api/admin/accounts/:id/toggle-freeze', authenticate, requireAdmin, (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const account = DB.getAllAccounts().find(a => a.id === id);
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    const newStatus = account.status === 'active' ? 'frozen' : 'active';
    const updated = DB.updateAccount(account.id, { status: newStatus });

    DB.createAuditLog({
      id: `aud_${Date.now()}`,
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: newStatus === 'frozen' ? 'ADMIN_FREEZE_ACCOUNT' : 'ADMIN_UNFREEZE_ACCOUNT',
      category: 'ADMIN',
      status: 'SUCCESS',
      details: `Admin set status to ${newStatus} for account ${account.accountNumber}`,
      referenceId: account.accountNumber,
      ipAddress: req.ip || '127.0.0.1',
      timestamp: new Date().toISOString(),
    });

    res.json({ message: `Account ${account.accountNumber} is now ${newStatus}`, account: updated });
  });

  app.get('/api/admin/transactions', authenticate, requireAdmin, (req, res) => {
    const { search, suspiciousOnly } = req.query;
    let txns = DB.getAllTransactions();

    if (suspiciousOnly === 'true') {
      txns = txns.filter(t => t.isSuspicious);
    }

    if (search) {
      const q = String(search).toLowerCase();
      txns = txns.filter(t =>
        t.senderName.toLowerCase().includes(q) ||
        t.receiverName.toLowerCase().includes(q) ||
        t.referenceId.toLowerCase().includes(q) ||
        t.accountNumber.toLowerCase().includes(q)
      );
    }

    res.json({ transactions: txns });
  });

  app.get('/api/admin/audit-logs', authenticate, requireAdmin, (req, res) => {
    const logs = DB.getAuditLogs(200);
    res.json({ logs });
  });

  // Admin / Manager Review KYC Submission
  app.post('/api/admin/kyc/review', authenticate, requireAdmin, (req: AuthenticatedRequest, res) => {
    try {
      const { userId, status, remarks } = req.body; // status: 'Full KYC' | 'Verified' | 'Rejected'
      const targetUser = DB.getUserById(userId);

      if (!targetUser) {
        res.status(404).json({ error: 'Customer not found' });
        return;
      }

      const updated = DB.updateUser(userId, {
        kycStatus: status as any,
        kycDetails: {
          ...(targetUser.kycDetails || {}),
          reviewedAt: new Date().toISOString(),
          reviewerRemarks: remarks || `Reviewed by Manager ${req.user!.name}`,
        },
      });

      DB.createNotification({
        id: `notif_${Date.now()}`,
        userId: targetUser.id,
        title: status === 'Full KYC' || status === 'Verified' ? 'KYC Verification Approved!' : 'KYC Verification Needs Action',
        message: status === 'Full KYC' || status === 'Verified'
          ? 'Congratulations! Your KYC documents have been reviewed and approved. Full banking limits are active.'
          : `KYC Review Update: ${remarks || 'Please re-submit required identity documents.'}`,
        type: 'security',
        isRead: false,
        createdAt: new Date().toISOString(),
      });

      DB.createAuditLog({
        id: `aud_${Date.now()}`,
        userId: req.user!.id,
        userEmail: req.user!.email,
        action: 'ADMIN_KYC_REVIEW',
        category: 'ADMIN',
        status: 'SUCCESS',
        details: `Manager ${req.user!.name} updated KYC status to '${status}' for ${targetUser.email}. Remarks: ${remarks || 'Approved'}`,
        referenceId: targetUser.customerNumber,
        ipAddress: req.ip || '127.0.0.1',
        timestamp: new Date().toISOString(),
      });

      res.json({
        message: `KYC for ${targetUser.name} updated to ${status}`,
        user: sanitizeUser(updated!),
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to review KYC' });
    }
  });

  // Admin Balance Adjustment / Deposit
  app.post('/api/admin/accounts/:id/adjust-balance', authenticate, requireAdmin, (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const { amount, type, description } = req.body;
      const account = DB.getAllAccounts().find(a => a.id === id);

      if (!account) {
        res.status(404).json({ error: 'Account not found' });
        return;
      }

      const numAmount = Number(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        res.status(400).json({ error: 'Valid positive amount required' });
        return;
      }

      const targetUser = DB.getUserById(account.userId);
      const isCredit = type === 'credit';
      const newBalance = isCredit ? account.balance + numAmount : Math.max(0, account.balance - numAmount);

      const updated = DB.updateAccount(account.id, { balance: newBalance });

      const txnId = `TXN-MGR-${Math.floor(10000000 + Math.random() * 90000000)}`;
      const refId = `MGR-${Math.floor(100000 + Math.random() * 900000)}`;

      const txn: Transaction = {
        id: txnId,
        userId: account.userId,
        accountNumber: account.accountNumber,
        senderName: isCredit ? `Manager Adjustment (${req.user!.name})` : (targetUser?.name || 'Account Holder'),
        senderAccountNumber: isCredit ? 'APEX-TREASURY' : account.accountNumber,
        receiverName: isCredit ? (targetUser?.name || 'Account Holder') : `Manager Adjustment (${req.user!.name})`,
        receiverAccountNumber: isCredit ? account.accountNumber : 'APEX-TREASURY',
        amount: numAmount,
        type: isCredit ? 'Credit' : 'Debit',
        category: 'Transfer',
        description: description || `Manager Balance Adjustment (${isCredit ? 'Credit' : 'Debit'}) by ${req.user!.name}`,
        status: 'completed',
        balanceAfter: newBalance,
        timestamp: new Date().toISOString(),
        referenceId: refId,
        channel: 'Web Banking',
      };
      DB.createTransaction(txn);

      DB.createNotification({
        id: `notif_${Date.now()}`,
        userId: account.userId,
        title: isCredit ? 'Balance Credited by Bank' : 'Balance Adjusted by Bank',
        message: `₹${numAmount.toLocaleString('en-IN')} has been ${isCredit ? 'credited to' : 'debited from'} your account ${account.accountNumber}. New balance: ₹${newBalance.toLocaleString('en-IN')}`,
        type: isCredit ? 'transfer_received' : 'transfer_sent',
        isRead: false,
        createdAt: new Date().toISOString(),
      });

      res.json({
        message: `Account balance updated to ₹${newBalance.toLocaleString('en-IN')}`,
        account: updated,
        transaction: txn,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to adjust balance' });
    }
  });

  // ==========================================
  // 13. WITHDRAWAL & LOW BALANCE ALERTS
  // ==========================================

  // Cash / ATM Withdrawal Endpoint
  app.post('/api/account/withdraw', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const account = DB.getAccountByUserId(user.id);
      const { amount, method, transactionPin } = req.body;

      if (!account) {
        res.status(404).json({ error: 'Account not found' });
        return;
      }

      if (account.status === 'frozen') {
        res.status(403).json({ error: 'Account is frozen. Withdrawals are disabled.' });
        return;
      }

      const withdrawAmount = Number(amount);
      if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
        res.status(400).json({ error: 'Please enter a valid withdrawal amount' });
        return;
      }

      if (withdrawAmount > account.balance) {
        res.status(400).json({
          error: `Insufficient balance. Available: ₹${account.balance.toLocaleString('en-IN')}, Requested: ₹${withdrawAmount.toLocaleString('en-IN')}`,
        });
        return;
      }

      if (!transactionPin || !verifyPin(transactionPin, user.transactionPinHash)) {
        res.status(401).json({ error: 'Invalid 4-digit Transaction Security PIN' });
        return;
      }

      const newBalance = account.balance - withdrawAmount;
      const updatedAccount = DB.updateAccount(account.id, { balance: newBalance });

      const txnId = `TXN-WTH-${Math.floor(10000000 + Math.random() * 90000000)}`;
      const refId = `ATM-${Math.floor(100000 + Math.random() * 900000)}`;
      const withdrawMethod = method || 'ATM Cash Withdrawal';

      const txn: Transaction = {
        id: txnId,
        userId: user.id,
        accountNumber: account.accountNumber,
        senderName: user.name,
        senderAccountNumber: account.accountNumber,
        receiverName: `${withdrawMethod} - Self`,
        receiverAccountNumber: 'CASH-DISPENSER',
        amount: withdrawAmount,
        type: 'Debit',
        category: 'Other',
        description: `Cash Withdrawal (${withdrawMethod})`,
        status: 'completed',
        balanceAfter: newBalance,
        timestamp: new Date().toISOString(),
        referenceId: refId,
        channel: withdrawMethod,
      };
      DB.createTransaction(txn);

      // Notification
      DB.createNotification({
        id: `notif_${Date.now()}`,
        userId: user.id,
        title: 'Cash Withdrawn Successfully',
        message: `₹${withdrawAmount.toLocaleString('en-IN')} debited via ${withdrawMethod}. Remaining Balance: ₹${newBalance.toLocaleString('en-IN')}. Ref: ${refId}`,
        type: 'transfer_sent',
        isRead: false,
        createdAt: new Date().toISOString(),
      });

      // Low balance alert trigger
      const threshold = account.lowBalanceThreshold || 5000;
      if (newBalance < threshold) {
        DB.createNotification({
          id: `notif_low_${Date.now()}`,
          userId: user.id,
          title: '⚠️ Low Balance Alert',
          message: `Your account balance (₹${newBalance.toLocaleString('en-IN')}) has fallen below your alert threshold of ₹${threshold.toLocaleString('en-IN')}. Please deposit funds to maintain minimum balance requirements.`,
          type: 'low_balance',
          isRead: false,
          createdAt: new Date().toISOString(),
        });
      }

      res.json({
        message: `₹${withdrawAmount.toLocaleString('en-IN')} withdrawn successfully!`,
        account: updatedAccount,
        transaction: txn,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to process cash withdrawal' });
    }
  });

  // Low Balance Threshold Configuration
  app.post('/api/account/low-balance-threshold', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const account = DB.getAccountByUserId(user.id);
      const { threshold } = req.body;

      if (!account) {
        res.status(404).json({ error: 'Account not found' });
        return;
      }

      const numThreshold = Number(threshold);
      if (isNaN(numThreshold) || numThreshold < 500 || numThreshold > 500000) {
        res.status(400).json({ error: 'Threshold must be between ₹500 and ₹5,00,000' });
        return;
      }

      const updated = DB.updateAccount(account.id, { lowBalanceThreshold: numThreshold });

      DB.createNotification({
        id: `notif_${Date.now()}`,
        userId: user.id,
        title: 'Low Balance Alert Threshold Updated',
        message: `You will be alerted whenever your account balance drops below ₹${numThreshold.toLocaleString('en-IN')}.`,
        type: 'system',
        isRead: false,
        createdAt: new Date().toISOString(),
      });

      res.json({
        message: `Low balance threshold set to ₹${numThreshold.toLocaleString('en-IN')}`,
        account: updated,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update alert threshold' });
    }
  });

  // ==========================================
  // 14. LOANS & CREDIT MANAGEMENT
  // ==========================================

  app.get('/api/loans', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const loans = DB.getLoansByUserId(req.user!.id);
      res.json({ loans });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch loans' });
    }
  });

  app.post('/api/loans/apply', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const { loanType, amount, tenureMonths, purpose, monthlyIncome, employmentType } = req.body;

      const numAmount = Number(amount);
      const numTenure = Number(tenureMonths) || 12;
      const numIncome = Number(monthlyIncome) || 50000;

      if (isNaN(numAmount) || numAmount < 10000 || numAmount > 5000000) {
        res.status(400).json({ error: 'Loan amount must be between ₹10,000 and ₹50,00,000' });
        return;
      }

      // Determine interest rate based on loan type
      const rateMap: Record<string, number> = {
        'Personal Loan': 10.5,
        'Home Loan': 8.4,
        'Auto Loan': 8.9,
        'Education Loan': 9.2,
        'Business Loan': 12.0,
        'Gold Loan': 7.5,
      };
      const interestRate = rateMap[loanType] || 10.5;

      // EMI calculation formula: P * r * (1+r)^n / ((1+r)^n - 1)
      const monthlyRate = (interestRate / 100) / 12;
      const factor = Math.pow(1 + monthlyRate, numTenure);
      const monthlyEmi = Math.round((numAmount * monthlyRate * factor) / (factor - 1));
      const totalPayable = monthlyEmi * numTenure;

      const loanId = `LOAN-${Math.floor(100000 + Math.random() * 900000)}`;
      const nextDue = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const newLoan: LoanApplication = {
        id: loanId,
        userId: user.id,
        customerName: user.name,
        customerNumber: user.customerNumber,
        loanType: loanType || 'Personal Loan',
        amount: numAmount,
        interestRate,
        tenureMonths: numTenure,
        monthlyEmi,
        totalPayable,
        purpose: purpose || 'General Financial Requirement',
        monthlyIncome: numIncome,
        employmentType: employmentType || 'Salaried',
        status: 'Pending',
        disbursedAmount: 0,
        remainingAmount: totalPayable,
        paidEmis: 0,
        totalEmis: numTenure,
        nextDueDate: nextDue,
        appliedAt: new Date().toISOString(),
      };

      DB.createLoan(newLoan);

      DB.createNotification({
        id: `notif_${Date.now()}`,
        userId: user.id,
        title: 'Loan Application Submitted',
        message: `Your application for ${newLoan.loanType} of ₹${numAmount.toLocaleString('en-IN')} is under manager review. Application ID: ${loanId}.`,
        type: 'system',
        isRead: false,
        createdAt: new Date().toISOString(),
      });

      res.status(201).json({
        message: 'Loan application submitted successfully and queued for Manager verification!',
        loan: newLoan,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to apply for loan' });
    }
  });

  app.post('/api/loans/:id/pay-emi', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const account = DB.getAccountByUserId(user.id);
      const { id } = req.params;
      const { transactionPin } = req.body;

      if (!account) {
        res.status(404).json({ error: 'Account not found' });
        return;
      }

      const loan = DB.getLoanById(id);
      if (!loan || loan.userId !== user.id) {
        res.status(404).json({ error: 'Loan record not found' });
        return;
      }

      if (loan.status !== 'Approved' && loan.status !== 'Disbursed') {
        res.status(400).json({ error: 'Cannot pay EMI for unapproved or closed loan' });
        return;
      }

      if (loan.remainingAmount <= 0 || loan.paidEmis >= loan.totalEmis) {
        res.status(400).json({ error: 'Loan is already fully repaid' });
        return;
      }

      const emiAmount = Math.min(loan.monthlyEmi, loan.remainingAmount);

      if (emiAmount > account.balance) {
        res.status(400).json({
          error: `Insufficient balance to pay EMI. Required: ₹${emiAmount.toLocaleString('en-IN')}, Available: ₹${account.balance.toLocaleString('en-IN')}`,
        });
        return;
      }

      if (!transactionPin || !verifyPin(transactionPin, user.transactionPinHash)) {
        res.status(401).json({ error: 'Invalid 4-digit Transaction Security PIN' });
        return;
      }

      const newBalance = account.balance - emiAmount;
      const newRemaining = Math.max(0, loan.remainingAmount - emiAmount);
      const newPaidEmis = loan.paidEmis + 1;
      const isClosed = newRemaining === 0 || newPaidEmis >= loan.totalEmis;

      DB.updateAccount(account.id, { balance: newBalance });
      const updatedLoan = DB.updateLoan(id, {
        remainingAmount: newRemaining,
        paidEmis: newPaidEmis,
        status: isClosed ? 'Closed' : 'Disbursed',
        nextDueDate: isClosed ? 'Completed' : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      });

      const txnId = `TXN-EMI-${Math.floor(10000000 + Math.random() * 90000000)}`;
      const txn: Transaction = {
        id: txnId,
        userId: user.id,
        accountNumber: account.accountNumber,
        senderName: user.name,
        senderAccountNumber: account.accountNumber,
        receiverName: `Loan Repayment: ${loan.loanType} (${loan.id})`,
        receiverAccountNumber: `LOAN-ESCROW-${loan.id.slice(-4)}`,
        amount: emiAmount,
        type: 'Debit',
        category: 'Bills',
        description: `Loan EMI installment (${newPaidEmis}/${loan.totalEmis}) for ${loan.id}`,
        status: 'completed',
        balanceAfter: newBalance,
        timestamp: new Date().toISOString(),
        referenceId: `EMI-${Date.now().toString().slice(-6)}`,
        channel: 'Web Banking',
      };
      DB.createTransaction(txn);

      DB.createNotification({
        id: `notif_${Date.now()}`,
        userId: user.id,
        title: isClosed ? '🎉 Loan Fully Repaid!' : 'Loan EMI Paid',
        message: isClosed
          ? `Congratulations! Your ${loan.loanType} (${loan.id}) has been fully repaid and closed.`
          : `EMI of ₹${emiAmount.toLocaleString('en-IN')} paid successfully for loan ${loan.id}. Remaining: ₹${newRemaining.toLocaleString('en-IN')}`,
        type: 'bill_payment',
        isRead: false,
        createdAt: new Date().toISOString(),
      });

      res.json({
        message: isClosed ? 'Loan fully repaid!' : 'EMI paid successfully',
        loan: updatedLoan,
        accountBalance: newBalance,
        transaction: txn,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to process EMI payment' });
    }
  });

  // Admin Loans Endpoints
  app.get('/api/admin/loans', authenticate, requireAdmin, (req, res) => {
    const loans = DB.getAllLoans();
    res.json({ loans });
  });

  app.post('/api/admin/loans/:id/review', authenticate, requireAdmin, (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const { action, remarks } = req.body; // action: 'Approve' | 'Disburse' | 'Reject'
      const loan = DB.getLoanById(id);

      if (!loan) {
        res.status(404).json({ error: 'Loan not found' });
        return;
      }

      const borrower = DB.getUserById(loan.userId);
      const borrowerAccount = DB.getAccountByUserId(loan.userId);

      let newStatus: LoanApplication['status'] = 'Approved';
      if (action === 'Reject') newStatus = 'Rejected';
      if (action === 'Disburse' || action === 'Approve') newStatus = 'Disbursed';

      let updatedLoan = DB.updateLoan(id, {
        status: newStatus,
        disbursedAmount: newStatus === 'Disbursed' ? loan.amount : loan.disbursedAmount,
        approvedAt: new Date().toISOString(),
        remarks: remarks || `Reviewed by Manager ${req.user!.name}`,
      });

      // If disbursed, credit borrower's bank balance!
      if (newStatus === 'Disbursed' && borrowerAccount) {
        const newBalance = borrowerAccount.balance + loan.amount;
        DB.updateAccount(borrowerAccount.id, { balance: newBalance });

        const txnId = `TXN-LND-${Math.floor(10000000 + Math.random() * 90000000)}`;
        DB.createTransaction({
          id: txnId,
          userId: borrowerAccount.userId,
          accountNumber: borrowerAccount.accountNumber,
          senderName: 'Apex Loan Disbursal Treasury',
          senderAccountNumber: 'APEX-LOAN-VAULT',
          receiverName: borrower?.name || 'Borrower',
          receiverAccountNumber: borrowerAccount.accountNumber,
          amount: loan.amount,
          type: 'Credit',
          category: 'Transfer',
          description: `Loan Disbursal Credit for ${loan.loanType} (${loan.id})`,
          status: 'completed',
          balanceAfter: newBalance,
          timestamp: new Date().toISOString(),
          referenceId: `DSB-${Math.floor(100000 + Math.random() * 900000)}`,
          channel: 'Web Banking',
        });
      }

      DB.createNotification({
        id: `notif_${Date.now()}`,
        userId: loan.userId,
        title: newStatus === 'Disbursed' ? '💰 Loan Disbursed into Account!' : newStatus === 'Approved' ? 'Loan Approved!' : 'Loan Application Update',
        message: newStatus === 'Disbursed'
          ? `Your loan ${loan.id} of ₹${loan.amount.toLocaleString('en-IN')} has been approved and credited directly to account ${borrowerAccount?.accountNumber}.`
          : `Your loan application ${loan.id} status is now: ${newStatus}.`,
        type: newStatus === 'Disbursed' ? 'transfer_received' : 'system',
        isRead: false,
        createdAt: new Date().toISOString(),
      });

      res.json({
        message: `Loan ${loan.id} updated to ${newStatus}`,
        loan: updatedLoan,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to review loan' });
    }
  });

  // ==========================================
  // 15. COMPLAINTS & GRIEVANCE TICKETING
  // ==========================================

  app.get('/api/complaints', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const complaints = DB.getComplaintsByUserId(req.user!.id);
      res.json({ complaints });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch complaints' });
    }
  });

  app.post('/api/complaints', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const { category, subject, priority, description } = req.body;

      if (!subject || !description) {
        res.status(400).json({ error: 'Subject and detailed description are required' });
        return;
      }

      const ticketId = `TKT-${Math.floor(100000 + Math.random() * 900000)}`;
      const newComplaint: Complaint = {
        id: ticketId,
        userId: user.id,
        customerName: user.name,
        customerEmail: user.email,
        customerNumber: user.customerNumber,
        category: category || 'Transaction Failure',
        subject: subject.trim(),
        priority: priority || 'Medium',
        description: description.trim(),
        status: 'Open',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      DB.createComplaint(newComplaint);

      DB.createNotification({
        id: `notif_${Date.now()}`,
        userId: user.id,
        title: 'Support Ticket Created',
        message: `Your grievance ticket #${ticketId} ("${subject}") has been registered. Our bank support team will respond within 24 hours.`,
        type: 'system',
        isRead: false,
        createdAt: new Date().toISOString(),
      });

      res.status(201).json({
        message: `Complaint ticket #${ticketId} lodged successfully`,
        complaint: newComplaint,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to submit complaint' });
    }
  });

  app.get('/api/admin/complaints', authenticate, requireAdmin, (req, res) => {
    const complaints = DB.getAllComplaints();
    res.json({ complaints });
  });

  app.post('/api/admin/complaints/:id/respond', authenticate, requireAdmin, (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const { status, adminResponse } = req.body;
      const complaint = DB.getComplaintById(id);

      if (!complaint) {
        res.status(404).json({ error: 'Complaint ticket not found' });
        return;
      }

      const updated = DB.updateComplaint(id, {
        status: status || 'In Progress',
        adminResponse: adminResponse || `Update from Bank Manager ${req.user!.name}`,
        updatedAt: new Date().toISOString(),
      });

      DB.createNotification({
        id: `notif_${Date.now()}`,
        userId: complaint.userId,
        title: `Support Ticket #${complaint.id} Update`,
        message: `Bank Manager Response: "${adminResponse}". Status: ${status}`,
        type: 'system',
        isRead: false,
        createdAt: new Date().toISOString(),
      });

      res.json({
        message: `Complaint #${id} updated to ${status}`,
        complaint: updated,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update complaint' });
    }
  });

  // ==========================================
  // 11. FIXED DEPOSITS & RECURRING DEPOSITS (FD/RD)
  // ==========================================

  // Get User's Fixed Deposits
  app.get('/api/fd', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const deposits = DB.getFixedDepositsByUserId(req.user!.id);
      res.json({ deposits });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch fixed deposits' });
    }
  });

  // Create Fixed Deposit
  app.post('/api/fd/create', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const { amount, tenureMonths, compoundingFrequency, transactionPin, autoRenewal, nomineeName } = req.body;
      const depositAmount = Number(amount);
      const tenure = Number(tenureMonths) || 12;

      if (!depositAmount || depositAmount < 5000 || depositAmount > 10000000) {
        res.status(400).json({ error: 'Fixed Deposit amount must be between ₹5,000 and ₹1,00,00,000' });
        return;
      }

      if (!transactionPin || !verifyPin(transactionPin, req.user!.transactionPinHash)) {
        res.status(400).json({ error: 'Invalid 4-digit Transaction PIN' });
        return;
      }

      const account = DB.getAccountByUserId(req.user!.id);
      if (!account) {
        res.status(404).json({ error: 'Primary bank account not found' });
        return;
      }

      if (account.status === 'frozen') {
        res.status(403).json({ error: 'Cannot create Fixed Deposit: Account is frozen' });
        return;
      }

      if (account.balance < depositAmount) {
        res.status(400).json({ error: `Insufficient account balance. Available: ₹${account.balance.toLocaleString('en-IN')}` });
        return;
      }

      // Calculate Interest Rate based on tenure
      let interestRate = 6.75;
      if (tenure >= 36) interestRate = 8.25;
      else if (tenure >= 24) interestRate = 7.75;
      else if (tenure >= 12) interestRate = 7.25;
      else if (tenure >= 6) interestRate = 6.75;

      const years = tenure / 12;
      const totalInterest = Math.round(depositAmount * (interestRate / 100) * years);
      const maturityAmount = depositAmount + totalInterest;

      const startDate = new Date();
      const maturityDate = new Date(startDate.getTime() + tenure * 30 * 24 * 60 * 60 * 1000);
      const fdNumber = `FD-${Math.floor(100000 + Math.random() * 900000)}`;

      const newFd: FixedDeposit = {
        id: `fd_${Date.now()}`,
        userId: req.user!.id,
        accountNumber: account.accountNumber,
        fdNumber,
        depositAmount,
        interestRate,
        tenureMonths: tenure,
        compoundingFrequency: compoundingFrequency || 'Quarterly',
        maturityAmount,
        interestEarned: totalInterest,
        startDate: startDate.toISOString(),
        maturityDate: maturityDate.toISOString(),
        status: 'Active',
        nomineeName: nomineeName || account.nominee?.name || req.user!.name,
        autoRenewal: !!autoRenewal,
      };

      // Deduct balance from account
      const updatedBalance = account.balance - depositAmount;
      DB.updateAccount(account.id, { balance: updatedBalance });
      DB.createFixedDeposit(newFd);

      // Ledger Transaction
      DB.createTransaction({
        id: `TXN-FD-${Date.now().toString().slice(-6)}`,
        userId: req.user!.id,
        accountNumber: account.accountNumber,
        senderName: req.user!.name,
        senderAccountNumber: account.accountNumber,
        receiverName: `Apex Term Deposit (${fdNumber})`,
        receiverAccountNumber: `FD-VAULT-${fdNumber}`,
        amount: depositAmount,
        type: 'Debit',
        category: 'Bills',
        description: `Fixed Deposit Booking: Certificate #${fdNumber} @ ${interestRate}% p.a. for ${tenure} Months`,
        status: 'completed',
        balanceAfter: updatedBalance,
        timestamp: new Date().toISOString(),
        referenceId: fdNumber,
        channel: 'Web Banking',
      });

      // Notification
      DB.createNotification({
        id: `notif_${Date.now()}`,
        userId: req.user!.id,
        title: `Fixed Deposit Created (${fdNumber})`,
        message: `₹${depositAmount.toLocaleString('en-IN')} booked at ${interestRate}% p.a. Maturity amount: ₹${maturityAmount.toLocaleString('en-IN')}.`,
        type: 'system',
        isRead: false,
        createdAt: new Date().toISOString(),
      });

      res.status(201).json({
        message: `Fixed Deposit #${fdNumber} booked successfully!`,
        deposit: newFd,
        updatedBalance,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to create Fixed Deposit' });
    }
  });

  // Premature Liquidation of Fixed Deposit
  app.post('/api/fd/:id/liquidate', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const { transactionPin } = req.body;

      if (!transactionPin || !verifyPin(transactionPin, req.user!.transactionPinHash)) {
        res.status(400).json({ error: 'Invalid 4-digit Transaction PIN' });
        return;
      }

      const fd = DB.getFixedDepositById(id);
      if (!fd || fd.userId !== req.user!.id) {
        res.status(404).json({ error: 'Fixed Deposit record not found' });
        return;
      }

      if (fd.status !== 'Active') {
        res.status(400).json({ error: `Fixed Deposit is already ${fd.status}` });
        return;
      }

      const account = DB.getAccountByUserId(req.user!.id);
      if (!account) {
        res.status(404).json({ error: 'Account not found' });
        return;
      }

      // Calculate liquidated refund (Principal + partial interest minus 1% premature penalty)
      const penaltyRate = Math.max(4.0, fd.interestRate - 1.0);
      const daysElapsed = Math.max(1, Math.floor((Date.now() - new Date(fd.startDate).getTime()) / (1000 * 60 * 60 * 24)));
      const accruedInterest = Math.round(fd.depositAmount * (penaltyRate / 100) * (daysElapsed / 365));
      const refundAmount = fd.depositAmount + accruedInterest;

      DB.updateFixedDeposit(id, { status: 'Liquidated' });
      const newBalance = account.balance + refundAmount;
      DB.updateAccount(account.id, { balance: newBalance });

      DB.createTransaction({
        id: `TXN-FDC-${Date.now().toString().slice(-6)}`,
        userId: req.user!.id,
        accountNumber: account.accountNumber,
        senderName: `Apex Term Deposit Closure (${fd.fdNumber})`,
        senderAccountNumber: `FD-VAULT-${fd.fdNumber}`,
        receiverName: req.user!.name,
        receiverAccountNumber: account.accountNumber,
        amount: refundAmount,
        type: 'Credit',
        category: 'Salary',
        description: `Premature Liquidation Credit for FD #${fd.fdNumber} (Principal: ₹${fd.depositAmount.toLocaleString('en-IN')} + Accrued: ₹${accruedInterest.toLocaleString('en-IN')})`,
        status: 'completed',
        balanceAfter: newBalance,
        timestamp: new Date().toISOString(),
        referenceId: `FDC-${fd.fdNumber}`,
        channel: 'Web Banking',
      });

      DB.createNotification({
        id: `notif_${Date.now()}`,
        userId: req.user!.id,
        title: `FD #${fd.fdNumber} Liquidated`,
        message: `₹${refundAmount.toLocaleString('en-IN')} has been credited back to your account ${account.accountNumber}.`,
        type: 'system',
        isRead: false,
        createdAt: new Date().toISOString(),
      });

      res.json({
        message: `FD #${fd.fdNumber} liquidated successfully. ₹${refundAmount.toLocaleString('en-IN')} credited to account.`,
        refundAmount,
        updatedBalance: newBalance,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to liquidate Fixed Deposit' });
    }
  });

  // Get User's Recurring Deposits
  app.get('/api/rd', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const deposits = DB.getRecurringDepositsByUserId(req.user!.id);
      res.json({ deposits });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch recurring deposits' });
    }
  });

  // Create Recurring Deposit
  app.post('/api/rd/create', authenticate, (req: AuthenticatedRequest, res) => {
    try {
      const { monthlyInstallment, tenureMonths, transactionPin, autoDebit } = req.body;
      const installmentAmt = Number(monthlyInstallment);
      const tenure = Number(tenureMonths) || 12;

      if (!installmentAmt || installmentAmt < 500 || installmentAmt > 100000) {
        res.status(400).json({ error: 'Monthly RD installment must be between ₹500 and ₹1,00,000' });
        return;
      }

      if (!transactionPin || !verifyPin(transactionPin, req.user!.transactionPinHash)) {
        res.status(400).json({ error: 'Invalid 4-digit Transaction PIN' });
        return;
      }

      const account = DB.getAccountByUserId(req.user!.id);
      if (!account || account.balance < installmentAmt) {
        res.status(400).json({ error: 'Insufficient balance to pay first RD installment' });
        return;
      }

      const interestRate = 7.15;
      const totalDeposited = installmentAmt; // first installment
      const totalTenureDeposited = installmentAmt * tenure;
      const totalInterest = Math.round((installmentAmt * tenure * (tenure + 1) / 24) * (interestRate / 100));
      const maturityAmount = totalTenureDeposited + totalInterest;

      const startDate = new Date();
      const maturityDate = new Date(startDate.getTime() + tenure * 30 * 24 * 60 * 60 * 1000);
      const nextInstallmentDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
      const rdNumber = `RD-${Math.floor(100000 + Math.random() * 900000)}`;

      const newRd: RecurringDeposit = {
        id: `rd_${Date.now()}`,
        userId: req.user!.id,
        accountNumber: account.accountNumber,
        rdNumber,
        monthlyInstallment: installmentAmt,
        interestRate,
        tenureMonths: tenure,
        totalDeposited,
        maturityAmount,
        interestEarned: totalInterest,
        installmentsPaid: 1,
        totalInstallments: tenure,
        startDate: startDate.toISOString(),
        maturityDate: maturityDate.toISOString(),
        nextInstallmentDate: nextInstallmentDate.toISOString(),
        status: 'Active',
        autoDebit: !!autoDebit,
      };

      const updatedBalance = account.balance - installmentAmt;
      DB.updateAccount(account.id, { balance: updatedBalance });
      DB.createRecurringDeposit(newRd);

      DB.createTransaction({
        id: `TXN-RD-${Date.now().toString().slice(-6)}`,
        userId: req.user!.id,
        accountNumber: account.accountNumber,
        senderName: req.user!.name,
        senderAccountNumber: account.accountNumber,
        receiverName: `Apex RD Vault (${rdNumber})`,
        receiverAccountNumber: `RD-VAULT-${rdNumber}`,
        amount: installmentAmt,
        type: 'Debit',
        category: 'Bills',
        description: `Recurring Deposit 1st Installment Debit for Account #${rdNumber}`,
        status: 'completed',
        balanceAfter: updatedBalance,
        timestamp: new Date().toISOString(),
        referenceId: rdNumber,
        channel: 'Web Banking',
      });

      DB.createNotification({
        id: `notif_${Date.now()}`,
        userId: req.user!.id,
        title: `Recurring Deposit Account #${rdNumber} Active`,
        message: `Monthly installment of ₹${installmentAmt.toLocaleString('en-IN')} booked. Maturity target: ₹${maturityAmount.toLocaleString('en-IN')}.`,
        type: 'system',
        isRead: false,
        createdAt: new Date().toISOString(),
      });

      res.status(201).json({
        message: `Recurring Deposit #${rdNumber} opened successfully!`,
        deposit: newRd,
        updatedBalance,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create Recurring Deposit' });
    }
  });

  // ==========================================
  // 12. BANK MANAGER EXTENDED MODULES & CONTROLS
  // ==========================================

  // Admin Create Customer Directly
  const handleAdminCreateCustomer = (req: AuthenticatedRequest, res: any) => {
    try {
      const { name, email, phone, password, transactionPin, initialBalance, initialDeposit, accountType, address, city, state, pinCode } = req.body;
      if (!name || !email) {
        res.status(400).json({ error: 'Name and email are mandatory' });
        return;
      }

      if (DB.getUserByEmail(email.trim())) {
        res.status(400).json({ error: 'A customer with this email already exists' });
        return;
      }

      const userId = `user_${Date.now()}`;
      const customerNumber = `CUST-${Math.floor(100000 + Math.random() * 900000)}`;
      const accountNumber = `APEX${Math.floor(100000000 + Math.random() * 900000000)}`;
      const bal = Number(initialDeposit !== undefined ? initialDeposit : (initialBalance !== undefined ? initialBalance : 25000)) || 0;
      const userPassword = password || 'Password@123';
      const userPin = transactionPin && String(transactionPin).length === 4 ? String(transactionPin) : '1234';

      const newUser: User = {
        id: userId,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone || '+91 98000 00000',
        passwordHash: hashPassword(userPassword),
        role: 'user',
        avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
        address: address || 'Apex Prime Enclave',
        city: city || 'Mumbai',
        state: state || 'Maharashtra',
        pinCode: pinCode || '400001',
        kycStatus: 'Full KYC',
        customerNumber,
        failedLoginAttempts: 0,
        isLocked: false,
        transactionPinHash: hashPin(userPin),
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
        themePreference: 'light',
      };

      const newAccount: Account = {
        id: `acc_${userId}`,
        userId,
        accountNumber,
        accountType: accountType || 'Savings Account',
        ifscCode: 'APEX0004921',
        branchName: 'Apex Digital Bank, Central Vault',
        balance: bal,
        currency: 'INR',
        status: 'active',
        dailyTransferLimit: 250000,
        createdAt: new Date().toISOString(),
      };

      const newCard: VirtualCard = {
        id: `card_${userId}`,
        userId,
        cardHolderName: name.toUpperCase(),
        cardNumber: `4532${Math.floor(100000000000 + Math.random() * 900000000000)}`,
        expiryDate: '12/30',
        cvv: Math.floor(100 + Math.random() * 900).toString(),
        cardType: 'Visa Platinum',
        isFrozen: false,
        dailyOnlineLimit: 75000,
        internationalEnabled: true,
        contactlessEnabled: true,
        createdAt: new Date().toISOString(),
      };

      DB.createUser(newUser);
      DB.createAccount(newAccount);
      DB.createVirtualCard(newCard);
      demoPasswordStore[email.trim().toLowerCase()] = userPassword;

      // Create opening deposit transaction if initial balance > 0
      if (bal > 0) {
        DB.createTransaction({
          id: `TXN-DEP-${Date.now().toString().slice(-6)}`,
          userId,
          accountNumber,
          senderName: 'Branch Cash Counter / Manager Deposit',
          senderAccountNumber: 'BRANCH-VAULT-01',
          receiverName: newUser.name,
          receiverAccountNumber: accountNumber,
          amount: bal,
          type: 'Deposit',
          category: 'Salary',
          description: 'Branch Account Opening Initial Deposit Credit',
          status: 'completed',
          balanceAfter: bal,
          timestamp: new Date().toISOString(),
          referenceId: `DEP-${Date.now().toString().slice(-6)}`,
          channel: 'Web Banking',
        });
      }

      DB.createAuditLog({
        id: `aud_${Date.now()}`,
        userId: req.user!.id,
        userEmail: req.user!.email,
        action: 'ADMIN_CREATE_CUSTOMER',
        category: 'ADMIN',
        status: 'SUCCESS',
        details: `Manager created customer ${newUser.name} with A/C ${accountNumber} and initial balance ₹${bal.toLocaleString('en-IN')}`,
        referenceId: customerNumber,
        ipAddress: req.ip || '127.0.0.1',
        timestamp: new Date().toISOString(),
      });

      res.status(201).json({
        message: `Customer ${newUser.name} registered and account #${accountNumber} opened successfully`,
        user: sanitizeUser(newUser),
        account: newAccount,
      });
    } catch (err) {
      console.error('Error creating customer from admin:', err);
      res.status(500).json({ error: 'Failed to create customer record' });
    }
  };

  app.post('/api/admin/users', authenticate, requireAdmin, handleAdminCreateCustomer);
  app.post('/api/admin/users/create', authenticate, requireAdmin, handleAdminCreateCustomer);

  // Admin Update Customer
  app.put('/api/admin/users/:id', authenticate, requireAdmin, (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const { name, phone, address, city, state, kycStatus } = req.body;
      const user = DB.getUserById(id);
      if (!user) {
        res.status(404).json({ error: 'Customer not found' });
        return;
      }

      const updated = DB.updateUser(id, {
        name: name || user.name,
        phone: phone || user.phone,
        address: address || user.address,
        city: city || user.city,
        state: state || user.state,
        kycStatus: kycStatus || user.kycStatus,
      });

      DB.createAuditLog({
        id: `aud_${Date.now()}`,
        userId: req.user!.id,
        userEmail: req.user!.email,
        action: 'ADMIN_UPDATE_CUSTOMER',
        category: 'ADMIN',
        status: 'SUCCESS',
        details: `Manager updated profile of ${user.name} (${user.customerNumber})`,
        referenceId: user.customerNumber,
        ipAddress: req.ip || '127.0.0.1',
        timestamp: new Date().toISOString(),
      });

      res.json({ message: 'Customer updated successfully', user: updated ? sanitizeUser(updated) : null });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update customer' });
    }
  });

  // Admin Delete / Deactivate Customer
  app.delete('/api/admin/users/:id', authenticate, requireAdmin, (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const user = DB.getUserById(id);
      if (!user) {
        res.status(404).json({ error: 'Customer not found' });
        return;
      }

      if (user.role === 'admin') {
        res.status(400).json({ error: 'Cannot deactivate bank manager account' });
        return;
      }

      DB.updateUser(id, { isLocked: true });
      const acc = DB.getAccountByUserId(id);
      if (acc) {
        DB.updateAccount(acc.id, { status: 'deactivated' });
      }

      DB.createAuditLog({
        id: `aud_${Date.now()}`,
        userId: req.user!.id,
        userEmail: req.user!.email,
        action: 'ADMIN_DEACTIVATE_CUSTOMER',
        category: 'ADMIN',
        status: 'WARNING',
        details: `Manager deactivated customer ${user.name} (${user.customerNumber})`,
        referenceId: user.customerNumber,
        ipAddress: req.ip || '127.0.0.1',
        timestamp: new Date().toISOString(),
      });

      res.json({ message: `Customer ${user.name} has been deactivated and account locked` });
    } catch (err) {
      res.status(500).json({ error: 'Failed to deactivate customer' });
    }
  });

  // Admin Account Status Change (active / frozen / deactivated)
  app.post('/api/admin/accounts/:id/status', authenticate, requireAdmin, (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const acc = DB.getAccountById(id);
      if (!acc) {
        res.status(404).json({ error: 'Account not found' });
        return;
      }

      const updated = DB.updateAccount(id, { status });
      DB.createAuditLog({
        id: `aud_${Date.now()}`,
        userId: req.user!.id,
        userEmail: req.user!.email,
        action: 'ADMIN_ACCOUNT_STATUS_CHANGE',
        category: 'ADMIN',
        status: 'SUCCESS',
        details: `Manager set account #${acc.accountNumber} status to ${status}`,
        referenceId: acc.accountNumber,
        ipAddress: req.ip || '127.0.0.1',
        timestamp: new Date().toISOString(),
      });

      res.json({ message: `Account #${acc.accountNumber} status updated to ${status}`, account: updated });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update account status' });
    }
  });

  // Admin Cards List
  app.get('/api/admin/cards', authenticate, requireAdmin, (req, res) => {
    const cards = DB.getAllVirtualCards();
    res.json({ cards });
  });

  // Admin Issue New Card
  app.post('/api/admin/cards/issue', authenticate, requireAdmin, (req: AuthenticatedRequest, res) => {
    try {
      const { userId, cardType, dailyLimit } = req.body;
      const targetUser = DB.getUserById(userId);
      if (!targetUser) {
        res.status(404).json({ error: 'Customer not found' });
        return;
      }

      const newCard: VirtualCard = {
        id: `card_${Date.now()}`,
        userId,
        cardHolderName: targetUser.name.toUpperCase(),
        cardNumber: `4532${Math.floor(100000000000 + Math.random() * 900000000000)}`,
        expiryDate: '12/31',
        cvv: Math.floor(100 + Math.random() * 900).toString(),
        cardType: cardType || 'Visa Platinum',
        isFrozen: false,
        dailyOnlineLimit: Number(dailyLimit) || 50000,
        internationalEnabled: true,
        contactlessEnabled: true,
        createdAt: new Date().toISOString(),
      };

      DB.createVirtualCard(newCard);

      DB.createNotification({
        id: `notif_${Date.now()}`,
        userId,
        title: 'New Card Issued',
        message: `Bank Manager issued a new ${newCard.cardType} card ending in ...${newCard.cardNumber.slice(-4)}.`,
        type: 'card_action',
        isRead: false,
        createdAt: new Date().toISOString(),
      });

      res.status(201).json({ message: 'Card issued successfully', card: newCard });
    } catch (err) {
      res.status(500).json({ error: 'Failed to issue card' });
    }
  });

  // Admin Freeze / Unfreeze Card
  app.post('/api/admin/cards/:id/freeze', authenticate, requireAdmin, (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const card = DB.getAllVirtualCards().find(c => c.id === id);
      if (!card) {
        res.status(404).json({ error: 'Card not found' });
        return;
      }

      const updated = DB.updateVirtualCard(card.userId, { isFrozen: !card.isFrozen });
      DB.createAuditLog({
        id: `aud_${Date.now()}`,
        userId: req.user!.id,
        userEmail: req.user!.email,
        action: updated.isFrozen ? 'ADMIN_FREEZE_CARD' : 'ADMIN_UNFREEZE_CARD',
        category: 'SECURITY',
        status: 'WARNING',
        details: `Manager ${updated.isFrozen ? 'froze' : 'unfroze'} card ending in ...${card.cardNumber.slice(-4)}`,
        referenceId: card.id,
        ipAddress: req.ip || '127.0.0.1',
        timestamp: new Date().toISOString(),
      });

      res.json({ message: `Card ${updated.isFrozen ? 'frozen' : 'activated'} successfully`, card: updated });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update card status' });
    }
  });

  // Admin Flag / Clear Transaction Fraud
  app.post('/api/admin/transactions/:id/flag', authenticate, requireAdmin, (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const { suspicionReason } = req.body;
      const txn = DB.getTransactionById(id);
      if (!txn) {
        res.status(404).json({ error: 'Transaction not found' });
        return;
      }

      const updated = DB.updateTransaction(id, {
        isSuspicious: true,
        suspicionReason: suspicionReason || 'Flagged by Manager for high velocity / amount risk',
        status: 'flagged',
      });

      DB.createAuditLog({
        id: `aud_${Date.now()}`,
        userId: req.user!.id,
        userEmail: req.user!.email,
        action: 'ADMIN_FLAG_TRANSACTION',
        category: 'SECURITY',
        status: 'WARNING',
        details: `Manager flagged transaction #${id} as suspicious: ${suspicionReason}`,
        referenceId: id,
        ipAddress: req.ip || '127.0.0.1',
        timestamp: new Date().toISOString(),
      });

      res.json({ message: `Transaction #${id} flagged for compliance review`, transaction: updated });
    } catch (err) {
      res.status(500).json({ error: 'Failed to flag transaction' });
    }
  });

  app.post('/api/admin/transactions/:id/approve', authenticate, requireAdmin, (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const txn = DB.getTransactionById(id);
      if (!txn) {
        res.status(404).json({ error: 'Transaction not found' });
        return;
      }

      const updated = DB.updateTransaction(id, {
        isSuspicious: false,
        status: 'completed',
      });

      DB.createAuditLog({
        id: `aud_${Date.now()}`,
        userId: req.user!.id,
        userEmail: req.user!.email,
        action: 'ADMIN_APPROVE_TRANSACTION',
        category: 'SECURITY',
        status: 'SUCCESS',
        details: `Manager cleared suspicious flag and approved transaction #${id}`,
        referenceId: id,
        ipAddress: req.ip || '127.0.0.1',
        timestamp: new Date().toISOString(),
      });

      res.json({ message: `Transaction #${id} approved and marked clean`, transaction: updated });
    } catch (err) {
      res.status(500).json({ error: 'Failed to approve transaction' });
    }
  });

  // Admin Broadcast Announcement / Alert
  app.post('/api/admin/notifications/broadcast', authenticate, requireAdmin, (req: AuthenticatedRequest, res) => {
    try {
      const { title, message, type, targetUserId } = req.body;
      if (!title || !message) {
        res.status(400).json({ error: 'Title and message are required' });
        return;
      }

      const notifType = type || 'system';
      const users = targetUserId
        ? DB.getAllUsers().filter(u => u.id === targetUserId)
        : DB.getAllUsers().filter(u => u.role === 'user');

      users.forEach(u => {
        DB.createNotification({
          id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          userId: u.id,
          title: `[Manager Announcement] ${title}`,
          message,
          type: notifType,
          isRead: false,
          createdAt: new Date().toISOString(),
        });
      });

      DB.createAuditLog({
        id: `aud_${Date.now()}`,
        userId: req.user!.id,
        userEmail: req.user!.email,
        action: 'ADMIN_BROADCAST_NOTIFICATION',
        category: 'ADMIN',
        status: 'SUCCESS',
        details: `Manager broadcast notification "${title}" to ${users.length} recipient(s)`,
        ipAddress: req.ip || '127.0.0.1',
        timestamp: new Date().toISOString(),
      });

      res.json({ message: `Broadcast successfully dispatched to ${users.length} customer account(s)` });
    } catch (err) {
      res.status(500).json({ error: 'Failed to broadcast notification' });
    }
  });

  // Admin Reports Data API
  app.get('/api/admin/reports/:type', authenticate, requireAdmin, (req: AuthenticatedRequest, res) => {
    try {
      const { type } = req.params;
      const txns = DB.getAllTransactions();
      const users = DB.getAllUsers().filter(u => u.role === 'user');
      const accounts = DB.getAllAccounts();
      const loans = DB.getAllLoans();

      let reportData: any = {};

      if (type === 'daily' || type === 'monthly') {
        reportData = {
          title: type === 'daily' ? 'Daily Transaction Audit Report' : 'Monthly Financial Performance Report',
          generatedAt: new Date().toISOString(),
          totalVolume: txns.length,
          totalCredits: txns.filter(t => t.type === 'Credit' || t.type === 'Deposit').reduce((s, t) => s + t.amount, 0),
          totalDebits: txns.filter(t => t.type === 'Debit' || t.type === 'Withdrawal' || t.type === 'Transfer').reduce((s, t) => s + t.amount, 0),
          transactions: txns.slice(0, 50),
        };
      } else if (type === 'customers') {
        reportData = {
          title: 'Customer Directory & KYC Dossier Report',
          totalCustomers: users.length,
          activeCount: users.filter(u => !u.isLocked).length,
          verifiedKycCount: users.filter(u => u.kycStatus === 'Full KYC' || u.kycStatus === 'Verified').length,
          customers: users.map(u => ({
            id: u.id,
            name: u.name,
            email: u.email,
            phone: u.phone,
            customerNumber: u.customerNumber,
            kycStatus: u.kycStatus,
            status: u.isLocked ? 'Locked' : 'Active',
            joinedDate: u.createdAt,
          })),
        };
      } else if (type === 'deposits' || type === 'withdrawals') {
        const targetType = type === 'deposits' ? 'Deposit' : 'Withdrawal';
        const filtered = txns.filter(t => t.type === targetType);
        reportData = {
          title: `${targetType} Portfolio Report`,
          count: filtered.length,
          totalAmount: filtered.reduce((s, t) => s + t.amount, 0),
          transactions: filtered,
        };
      } else if (type === 'loans') {
        reportData = {
          title: 'Loan Applications & Repayment Risk Report',
          totalApplications: loans.length,
          totalDisbursed: loans.filter(l => l.status === 'Disbursed').reduce((s, l) => s + l.amount, 0),
          pendingReview: loans.filter(l => l.status === 'Pending').length,
          loans,
        };
      } else if (type === 'fraud') {
        const suspicious = txns.filter(t => t.isSuspicious || t.status === 'flagged');
        reportData = {
          title: 'Anti-Money Laundering (AML) & Fraud Threat Report',
          suspiciousCount: suspicious.length,
          flaggedTransactions: suspicious,
        };
      } else {
        reportData = {
          title: 'Comprehensive Bank Ledger Summary',
          totalBankLiquidity: accounts.reduce((s, a) => s + (Number(a.balance) || 0), 0),
          accounts,
        };
      }

      res.json({ report: reportData });
    } catch (err) {
      res.status(500).json({ error: 'Failed to generate report' });
    }
  });

  // Helper sanitizer to prevent leaking passwords or PIN hashes
  function sanitizeUser(user: User) {
    const { passwordHash, transactionPinHash, ...safe } = user;
    return safe;
  }

  // ==========================================
  // 13. VITE MIDDLEWARE & SPA SERVING
  // ==========================================

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Apex Bank Server] Online and running at http://localhost:${PORT}`);
  });
}

startServer();
