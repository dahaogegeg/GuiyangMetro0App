require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('password123', 10);

  // 1. Create Users
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: { password: passwordHash },
    create: {
      username: 'admin',
      password: passwordHash,
      name: '系统管理员',
      role: 'ADMIN',
      department: 'MANAGEMENT',
    },
  });

  const captain = await prisma.user.upsert({
    where: { username: 'captain' },
    update: { password: passwordHash },
    create: {
      username: 'captain',
      password: passwordHash,
      name: '张队长',
      role: 'CAPTAIN',
      department: 'DRIVER',
    },
  });

  const driver = await prisma.user.upsert({
    where: { username: 'driver01' },
    update: { password: passwordHash },
    create: {
      username: 'driver01',
      password: passwordHash,
      name: '李司机',
      role: 'EMPLOYEE',
      department: 'DRIVER',
    },
  });
  
  const driver2 = await prisma.user.upsert({
    where: { username: 'driver02' },
    update: { password: passwordHash },
    create: {
      username: 'driver02',
      password: passwordHash,
      name: '王司机',
      role: 'EMPLOYEE',
      department: 'DRIVER',
    },
  });

  console.log('Users created/updated');

  // 2. Create Routes (交路)
  const route101 = await prisma.route.create({
    data: { name: '早班101', code: '101', standardHours: 6.5, standardKm: 120 },
  });
  const route102 = await prisma.route.create({
    data: { name: '白班102', code: '102', standardHours: 7.5, standardKm: 140 },
  });
  const route103 = await prisma.route.create({
    data: { name: '夜班103', code: '103', standardHours: 8.0, standardKm: 150 },
  });

  console.log('Routes created');

  // 3. Create Schedules
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const shifts = ['MORNING', 'DAY', 'NIGHT', 'OFF'];

  // Clear existing schedules
  await prisma.schedule.deleteMany({
    where: {
      userId: { in: [captain.id, driver.id, driver2.id] }
    }
  });

  for (let i = 0; i < 30; i++) { // Generate for 30 days
    const date = new Date(today);
    date.setDate(today.getDate() + i);

    // Captain Schedule (Admin/Management usually works standard days)
    await prisma.schedule.create({
      data: {
        userId: captain.id,
        date: date,
        shiftType: 'DAY',
        status: 'DUTY',
        workHours: 8,
        note: '队长值班',
      },
    });

    // Driver 1 Schedule
    const shiftIndex = i % 4;
    let routeId = null;
    let workHours = 0;
    let kilometers = 0;

    if (shifts[shiftIndex] === 'MORNING') {
      routeId = route101.id;
      workHours = route101.standardHours;
      kilometers = route101.standardKm;
    } else if (shifts[shiftIndex] === 'DAY') {
      routeId = route102.id;
      workHours = route102.standardHours;
      kilometers = route102.standardKm;
    } else if (shifts[shiftIndex] === 'NIGHT') {
      routeId = route103.id;
      workHours = route103.standardHours;
      kilometers = route103.standardKm;
    }

    await prisma.schedule.create({
      data: {
        userId: driver.id,
        date: date,
        shiftType: shifts[shiftIndex],
        status: shifts[shiftIndex] === 'OFF' ? 'OFF' : 'DUTY',
        routeId: routeId,
        workHours: workHours,
        kilometers: kilometers,
      },
    });
  }

  console.log('Schedules created');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
