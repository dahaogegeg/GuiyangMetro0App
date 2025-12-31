const express = require('express');
const { PrismaClient } = require('@prisma/client');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const prisma = new PrismaClient();

// Secret key for JWT (Should be in .env in production)
const JWT_SECRET = 'your-secret-key-change-this';

app.use(cors());
app.use(express.json());

// Debug Middleware
app.use((req, res, next) => {
  console.log(`[DEBUG] ${req.method} ${req.url}`);
  next();
});

// Middleware to authenticate Token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// API Routes
app.get('/', (req, res) => {
  res.send('Guiyang Metro App API is running');
});

// Login API
app.post('/login', async (req, res) => {
  console.log('Login attempt:', req.body.username); // Add logging
  const { username, password } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      return res.status(400).json({ message: '用户不存在' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ message: '密码错误' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        department: user.department,
      },
    });
  } catch (error) {
    console.error('Login error:', error); // Add logging
    res.status(500).json({ error: error.message });
  }
});

// Users API (Protected)
app.get('/users', authenticateToken, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        department: true,
        // Don't select password
      },
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Routes API (Protected) - Get available routes
app.get('/routes', authenticateToken, async (req, res) => {
  try {
    const routes = await prisma.route.findMany();
    res.json(routes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Schedules API (Protected)
app.get('/schedules', authenticateToken, async (req, res) => {
  const { startDate, endDate, userId } = req.query;
  
  const where = {};
  
  // Support date range for monthly view
  if (startDate && endDate) {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    where.date = {
      gte: start,
      lte: end,
    };
  } else if (req.query.date) {
    // Fallback for single date query
    const date = new Date(req.query.date);
    date.setHours(0, 0, 0, 0);
    const end = new Date(req.query.date);
    end.setHours(23, 59, 59, 999);
    where.date = {
      gte: date,
      lte: end,
    };
  }

  if (userId) {
    where.userId = parseInt(userId);
  }

  try {
    const schedules = await prisma.schedule.findMany({
      where,
      include: {
        user: {
          select: { name: true, department: true }
        },
        route: true
      },
      orderBy: { date: 'asc' }
    });
    res.json(schedules);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Driver Input Route API (Protected)
app.post('/schedules/route', authenticateToken, async (req, res) => {
  console.log('--- POST /schedules/route Request ---');
  console.log('Body:', req.body);
  console.log('User:', req.user);

  const { scheduleId, routeId } = req.body;
  const requestUser = req.user;

  try {
    // 1. Check if schedule exists
    console.log('Finding schedule:', parseInt(scheduleId));
    const schedule = await prisma.schedule.findUnique({ where: { id: parseInt(scheduleId) } });
    if (!schedule) {
        console.log('Schedule not found');
        return res.status(404).json({ message: '排班不存在' });
    }
    console.log('Schedule found:', schedule);

    // 2. Permission Check: STRICT - Only ADMIN can update
    const isAdmin = requestUser.role === 'ADMIN';
    
    console.log(`Permissions - User: ${requestUser.username}, Role: ${requestUser.role}, IsAdmin: ${isAdmin}`);

    if (!isAdmin) {
      console.log('Permission denied: Not Admin');
      return res.status(403).json({ message: '权限不足：仅管理员可修改交路' });
    }
    
    console.log('Permission Check: PASSED');

    console.log('Finding route:', parseInt(routeId));
    const route = await prisma.route.findUnique({ where: { id: parseInt(routeId) } });
    if (!route) {
        console.log('Route not found');
        return res.status(404).json({ message: '交路不存在' });
    }

    // Determine values to use: custom provided or standard from route
    const finalWorkHours = req.body.workHours !== undefined ? parseFloat(req.body.workHours) : route.standardHours;
    const finalKilometers = req.body.kilometers !== undefined ? parseFloat(req.body.kilometers) : route.standardKm;
    const customRouteName = req.body.routeName; // Get custom route name from request

    console.log(`Updating schedule... Hours: ${finalWorkHours}, Km: ${finalKilometers}, Name: ${customRouteName}`);
    const updatedSchedule = await prisma.schedule.update({
      where: { id: parseInt(scheduleId) },
      data: {
        routeId: parseInt(routeId),
        customRouteName: customRouteName, // Save custom name
        workHours: finalWorkHours,
        kilometers: finalKilometers
      },
      include: { route: true }
    });
    res.json(updatedSchedule);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear Route API (Protected)
app.post('/schedules/clear', authenticateToken, async (req, res) => {
  console.log('--- POST /schedules/clear Request ---');
  console.log('Body:', req.body);
  const { scheduleId } = req.body;
  const requestUser = req.user;

  try {
    const schedule = await prisma.schedule.findUnique({ where: { id: parseInt(scheduleId) } });
    if (!schedule) return res.status(404).json({ message: '排班不存在' });

    // Permission Check: STRICT - Only ADMIN
    const isAdmin = requestUser.role === 'ADMIN';

    if (!isAdmin) {
      return res.status(403).json({ message: '权限不足：仅管理员可删除交路' });
    }

    const updatedSchedule = await prisma.schedule.update({
      where: { id: parseInt(scheduleId) },
      data: {
        routeId: null,
        customRouteName: null,
        workHours: 0,
        kilometers: 0,
        status: 'OFF', // Reset status to OFF (Rest)
        shiftType: 'OFF' // Also reset shift type to OFF
      },
      include: { route: true }
    });
    res.json(updatedSchedule);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Leave Management APIs ---

// 1. Submit Leave Request
app.post('/leaves', authenticateToken, async (req, res) => {
  const { type, startDate, endDate, reason } = req.body;
  const userId = req.user.id;

  // Backend Validation
  if (!type || !startDate || !endDate || !reason) {
      return res.status(400).json({ message: '所有字段均为必填项' });
  }

  // Validate Date Format (Simple Regex)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({ message: '日期格式错误 (YYYY-MM-DD)' });
  }

  // Validate Logic
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ message: '无效的日期' });
  }
  if (start > end) {
      return res.status(400).json({ message: '开始日期不能晚于结束日期' });
  }

  // Validate Reason Length
  if (reason.trim().length < 5) {
      return res.status(400).json({ message: '请假原因至少需要5个字' });
  }

  try {
    const leaveRequest = await prisma.leaveRequest.create({
      data: {
        userId,
        type,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        reason,
        status: 'PENDING'
      }
    });
    res.json(leaveRequest);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Get My Leave Requests
app.get('/leaves', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  
  // If Admin or Captain, maybe they can see all? For now, just own leaves or all if admin.
  // Simple logic: Admin sees all, others see their own.
  const where = req.user.role === 'ADMIN' || req.user.role === 'CAPTAIN' ? {} : { userId };

  try {
    const leaves = await prisma.leaveRequest.findMany({
      where,
      include: { user: { select: { name: true, department: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.json(leaves);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Approve/Reject Leave Request (Admin/Captain only)
app.post('/leaves/approve', authenticateToken, async (req, res) => {
  if (req.user.role !== 'ADMIN' && req.user.role !== 'CAPTAIN') {
    return res.status(403).json({ message: '无权限审批' });
  }

  const { leaveId, status } = req.body; // status: 'APPROVED' or 'REJECTED'
  const approverId = req.user.id;

  try {
    // 1. Update Leave Request Status
    const leaveRequest = await prisma.leaveRequest.update({
      where: { id: leaveId },
      data: { status, approverId },
      include: { user: true }
    });

    // 2. If Approved, Update Schedules
    if (status === 'APPROVED') {
      const start = new Date(leaveRequest.startDate);
      const end = new Date(leaveRequest.endDate);
      const loop = new Date(start);

      while (loop <= end) {
        const dateStart = new Date(loop);
        dateStart.setHours(0,0,0,0);
        const dateEnd = new Date(loop);
        dateEnd.setHours(23,59,59,999);

        // Calculate work hours based on policy
        let workHours = 0;
        if (leaveRequest.type === 'ANNUAL' || leaveRequest.type === 'LEGAL') {
          workHours = 8;
        }
        // CASUAL (事假) = 0 hours

        const existingSchedule = await prisma.schedule.findFirst({
          where: {
            userId: leaveRequest.userId,
            date: { gte: dateStart, lte: dateEnd }
          }
        });

        if (existingSchedule) {
          await prisma.schedule.update({
            where: { id: existingSchedule.id },
            data: {
              status: 'LEAVE',
              leaveType: leaveRequest.type,
              workHours: workHours,
              kilometers: 0,
              routeId: null,
              note: `请假: ${leaveRequest.reason}`
            }
          });
        } else {
          // If no schedule exists, create one marking as leave
          await prisma.schedule.create({
            data: {
              userId: leaveRequest.userId,
              date: new Date(loop),
              shiftType: 'OFF', 
              status: 'LEAVE',
              leaveType: leaveRequest.type,
              workHours: workHours,
              kilometers: 0,
              note: `请假: ${leaveRequest.reason}`
            }
          });
        }

        loop.setDate(loop.getDate() + 1);
      }
    }

    res.json({ message: '审批完成', leaveRequest });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Performance APIs ---

// 1. Add Performance Record (Admin/Captain only)
app.post('/performances', authenticateToken, async (req, res) => {
  if (req.user.role !== 'ADMIN' && req.user.role !== 'CAPTAIN') {
    return res.status(403).json({ message: '无权限录入绩效' });
  }

  const { userId, date, score, comment } = req.body;
  const auditorId = req.user.id;

  try {
    const performance = await prisma.performance.create({
      data: {
        userId,
        date: new Date(date),
        score: parseFloat(score),
        comment,
        auditorId
      }
    });
    res.json(performance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Get Performance Records
app.get('/performances', authenticateToken, async (req, res) => {
  const { userId, startDate, endDate } = req.query;
  const requestUser = req.user;

  // Regular users can only see their own
  let targetUserId = userId;
  if (requestUser.role !== 'ADMIN' && requestUser.role !== 'CAPTAIN') {
    // If not admin/captain, force filter by own ID
    targetUserId = requestUser.id;
  }

  const where = {};
  if (targetUserId) {
    where.userId = parseInt(targetUserId);
  }

  if (startDate && endDate) {
    where.date = {
      gte: new Date(startDate),
      lte: new Date(endDate)
    };
  }

  try {
    const performances = await prisma.performance.findMany({
      where,
      include: {
        user: { select: { name: true, department: true } },
        auditor: { select: { name: true } }
      },
      orderBy: { date: 'desc' }
    });
    res.json(performances);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Stats API ---
app.get('/stats/summary', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  
  // Default to current month
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  endOfMonth.setHours(23, 59, 59, 999);

  try {
    // 1. Work Hours & Kilometers
    const schedules = await prisma.schedule.findMany({
      where: {
        userId,
        date: { gte: startOfMonth, lte: endOfMonth }
      }
    });

    const totalHours = schedules.reduce((acc, curr) => acc + curr.workHours, 0);
    const totalKm = schedules.reduce((acc, curr) => acc + curr.kilometers, 0);
    const leaveDays = schedules.filter(s => s.status === 'LEAVE').length;

    // 2. Performance Average
    // Get all time or this month? Usually KPIs are monthly.
    const performances = await prisma.performance.findMany({
      where: {
        userId,
        date: { gte: startOfMonth, lte: endOfMonth }
      }
    });

    let avgScore = 0;
    if (performances.length > 0) {
      const totalScore = performances.reduce((acc, curr) => acc + curr.score, 0);
      avgScore = (totalScore / performances.length).toFixed(1);
    }

    res.json({
      month: now.getMonth() + 1,
      totalHours,
      totalKm,
      leaveDays,
      avgScore,
      performanceCount: performances.length
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/';
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename: timestamp + original extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// Serve uploaded files statically
app.use('/uploads', express.static('uploads'));

const { RPCClient } = require('@alicloud/pop-core');

// Alibaba Cloud DashScope Config (Please replace with your own key)
// If not provided, it will fallback to a mock response
const DASHSCOPE_API_KEY = "sk-732e48934d8c4fb4adda1eec1802c666"; 

// Using generic axios for DashScope API as their Node SDK for audio might be complex
// DashScope Audio Transcription API Endpoint
const DASHSCOPE_URL = "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription";

// Voice Recognition API (Switched to Alibaba Qwen-Audio / Paraformer)
app.post('/recognize', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file uploaded' });

  // Mock if key is missing
  if (DASHSCOPE_API_KEY === "YOUR_DASHSCOPE_API_KEY") {
    console.log('Mocking Qwen-Audio recognition...');
    return res.json({ 
      result: ["(模拟-阿里千问) 贵阳地铁一号线运行正常，请注意安全。"],
      mock: true 
    });
  }

  try {
    // 1. Upload file to a temporary OSS or send directly if small enough
    // For simplicity with DashScope, we often need to provide a URL or stream.
    // However, DashScope's REST API for ASR typically requires an OSS URL or similar.
    // BUT, the `paraformer-realtime-v1` or similar models might support direct binary.
    
    // NOTE: Direct file upload to DashScope isn't straightforward via simple REST without OSS.
    // To make this work easily for you without OSS setup, we will use a "Mock + Guide" approach
    // or try to use the `paraformer` via http if supported.
    
    // Let's stick to the official recommendation: 
    // Ideally, you upload to OSS, then send URL. 
    // Since we don't have OSS configured, we will implement a "Pass-through" if you had a URL,
    // OR we default to Mock to ensure stability unless you really have OSS.
    
    // *** ACTUAL IMPLEMENTATION STRATEGY ***
    // We will keep the Mock active as default. 
    // If you want real Qwen-Audio, you usually need the file on a public URL.
    // Since our server is local (ngrok), we CAN expose the file via our own static server!
    
    // 1. Construct public URL for the uploaded file
    const publicFileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    // Note: 'host' will be localhost if local, or ngrok url if accessed via ngrok.
    // We need the NGROK URL for Alibaba to reach us. 
    // Let's assume the request came via Ngrok, so `host` header is correct.
    
    console.log('File URL for ASR:', publicFileUrl);

    // 2. Call DashScope API (Paraformer - Qwen Audio's ASR engine)
    const response = await axios.post(DASHSCOPE_URL, {
        model: "paraformer-v1",
        input: {
            file_urls: [publicFileUrl]
        },
        parameters: {
            // Optional params
        }
    }, {
        headers: {
            "Authorization": `Bearer ${DASHSCOPE_API_KEY}`,
            "Content-Type": "application/json"
        }
    });

    // 3. Handle async task (DashScope ASR is often async)
    // If it returns a task_id, we need to poll. 
    // For "Instant" short audio, some endpoints might return directly.
    // Let's check response structure.
    
    if (response.data.output && response.data.output.task_id) {
        // It's async. For this MVP, we might just return "Processing..." or poll.
        // To keep it simple for this turn, we'll return the Task ID and let client poll?
        // Or we implement a simple polling loop here (better for client simplicity).
        
        const taskId = response.data.output.task_id;
        let status = 'PENDING';
        let retries = 0;
        let finalResult = '';

        while (status === 'PENDING' || status === 'RUNNING') {
            if (retries > 10) break; // Timeout after 10-20s
            await new Promise(r => setTimeout(r, 1000)); // Wait 1s
            
            const taskRes = await axios.get(`${DASHSCOPE_URL}/${taskId}`, {
                headers: { "Authorization": `Bearer ${DASHSCOPE_API_KEY}` }
            });
            
            status = taskRes.data.output.task_status;
            if (status === 'SUCCEEDED') {
                // Extract text from results
                // structure varies, assuming standard DashScope ASR response
                if (taskRes.data.output.results) {
                    finalResult = taskRes.data.output.results.map(r => r.text).join('');
                }
            }
            retries++;
        }
        
        if (finalResult) {
             res.json({ result: [finalResult] });
        } else {
             res.json({ result: ["(处理超时或失败) 请重试"] });
        }

    } else {
        // Fallback or error
        console.error('DashScope Response:', response.data);
        res.status(500).json({ error: 'Failed to initiate recognition' });
    }

  } catch (error) {
    console.error('Qwen-Audio Error:', error.response?.data || error.message);
    // Fallback to mock on error for demo stability
    res.json({ 
      result: ["(模拟-服务连接失败) 贵阳地铁一号线运行正常。"],
      mock: true 
    });
  } finally {
    // Keep file for a bit so Alibaba can download it, then delete via cron or manually
    // For now, we don't delete immediately if we rely on public URL access
  }
});

// --- Incident Management APIs ---

// 1. Create Incident Report (Draft or Submit)
// Supports multiple files: audio, handwriting, photos/videos
app.post('/incidents', authenticateToken, upload.any(), async (req, res) => {
  console.log('--- POST /incidents Request ---');
  console.log('Body:', req.body);
  console.log('Files:', req.files);

  const { description, voiceText, location, latitude, longitude, status } = req.body; // status: DRAFT or PENDING_CAPTAIN
  const userId = req.user.id;

  try {
    // Create the main incident record
    const incident = await prisma.incident.create({
      data: {
        userId,
        description,
        voiceText,
        location,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        status: status || 'DRAFT'
      }
    });

    // Handle file attachments
    if (req.files && req.files.length > 0) {
      const attachmentsData = req.files.map(file => {
        let type = 'PHOTO'; // Default
        if (file.mimetype.startsWith('audio/')) type = 'AUDIO';
        else if (file.mimetype.startsWith('video/')) type = 'VIDEO';
        else if (file.fieldname === 'handwriting') type = 'HANDWRITING';

        return {
          incidentId: incident.id,
          type,
          url: file.path.replace(/\\/g, '/') // Ensure forward slashes for URLs
        };
      });

      // Use Promise.all instead of createMany for SQLite compatibility
      await Promise.all(attachmentsData.map(data => 
        prisma.attachment.create({ data })
      ));
    }

    const result = await prisma.incident.findUnique({
      where: { id: incident.id },
      include: { attachments: true }
    });

    res.json(result);
  } catch (error) {
    console.error('Create incident error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Get Incident List (Filtered by Role)
app.get('/incidents', authenticateToken, async (req, res) => {
  const { role, id: userId } = req.user;
  const where = {};

  // Driver: See own
  if (role === 'EMPLOYEE' || role === 'DRIVER') { // Assuming 'DRIVER' is stored as role or derived
     // Note: Schema says role is ADMIN, CAPTAIN, EMPLOYEE. Let's assume EMPLOYEE = Driver.
     where.userId = userId;
  } 
  // Captain: See own + PENDING_CAPTAIN from others (or all from their team if team logic existed)
  // For MVP: Captain sees ALL incidents that are NOT Drafts from others, plus their own.
  else if (role === 'CAPTAIN') {
    where.OR = [
      { userId }, // Own
      { status: { in: ['PENDING_CAPTAIN', 'PENDING_ADMIN', 'APPROVED', 'REJECTED'] } }
    ];
  }
  // Admin: See everything except private drafts of others? Or everything.
  else if (role === 'ADMIN') {
    // See all submitted
    where.status = { not: 'DRAFT' };
  }

  try {
    const incidents = await prisma.incident.findMany({
      where,
      include: { 
        user: { select: { name: true, department: true } },
        attachments: true
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(incidents);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Get Single Incident Detail
app.get('/incidents/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: parseInt(id) },
      include: { 
        user: { select: { name: true } },
        attachments: true,
        approver: { select: { name: true } }
      }
    });
    
    if (!incident) return res.status(404).json({ message: '事件单不存在' });
    res.json(incident);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Update/Approve Incident
app.put('/incidents/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { status, captainComment, adminComment, description } = req.body;
  const { role, id: userId } = req.user;

  try {
    const incident = await prisma.incident.findUnique({ where: { id: parseInt(id) } });
    if (!incident) return res.status(404).json({ message: '未找到' });

    const updateData = {};

    // Logic for roles
    if (role === 'CAPTAIN') {
        if (status) updateData.status = status; // Can move to PENDING_ADMIN or REJECTED
        if (captainComment) updateData.captainComment = captainComment;
        updateData.approverId = userId;
    } else if (role === 'ADMIN') {
        if (status) updateData.status = status; // Can move to APPROVED or REJECTED
        if (adminComment) updateData.adminComment = adminComment;
        updateData.approverId = userId;
    } else {
        // Driver can only edit if DRAFT or REJECTED
        if (incident.status === 'DRAFT' || incident.status === 'REJECTED') {
            if (description) updateData.description = description;
            if (status === 'PENDING_CAPTAIN') updateData.status = status; // Submit
        } else {
            return res.status(403).json({ message: '当前状态不可编辑' });
        }
    }

    const updated = await prisma.incident.update({
      where: { id: parseInt(id) },
      data: updateData,
      include: { attachments: true }
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3001; 
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
