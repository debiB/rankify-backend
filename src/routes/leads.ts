import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const router = Router();
const prisma = new PrismaClient();

// Admin JWT guard (same logic style as oauth.ts)
const verifyAdminToken = async (req: any, res: any, next: any) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token provided' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user || user.role !== 'ADMIN' || user.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    (req as any).user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// GET /leads?page=1&limit=10&search=abc
router.get('/', verifyAdminToken, async (req, res) => {
  try {
    const page = Math.max(parseInt(String(req.query.page || '1'), 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '10'), 10) || 10, 1), 100);
    const search = (req.query.search as string | undefined) || undefined;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } },
      ];
    }

    const [totalCount, leads] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          source: true,
          starRating: true,
          isDealClosed: true,
          workCompleted: true,
          dealAmount: true,
          submittedAt: true,
          createdAt: true,
        },
      }),
    ]);

    return res.json({
      leads,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasNextPage: page < Math.ceil(totalCount / limit),
        hasPrevPage: page > 1,
      },
    });
  } catch (err) {
    console.error('GET /leads failed', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// PUT /leads/:id
router.put('/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { starRating, isDealClosed, workCompleted, dealAmount } = req.body || {};

    const data: any = {};
    if (starRating !== undefined) {
      const r = Number(starRating);
      if (Number.isNaN(r) || r < 1 || r > 5) {
        return res.status(400).json({ error: 'starRating must be 1-5' });
      }
      data.starRating = r;
    }
    if (isDealClosed !== undefined) {
      if (typeof isDealClosed !== 'boolean') return res.status(400).json({ error: 'isDealClosed must be boolean' });
      data.isDealClosed = isDealClosed;
    }
    if (workCompleted !== undefined) {
      if (typeof workCompleted !== 'boolean') return res.status(400).json({ error: 'workCompleted must be boolean' });
      data.workCompleted = workCompleted;
    }
    if (dealAmount !== undefined) {
      const a = Number(dealAmount);
      if (Number.isNaN(a) || a < 0) return res.status(400).json({ error: 'dealAmount must be >= 0' });
      data.dealAmount = a;
    }

    const lead = await prisma.lead.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        source: true,
        starRating: true,
        isDealClosed: true,
        workCompleted: true,
        dealAmount: true,
        submittedAt: true,
        createdAt: true,
      },
    });

    return res.json({ success: true, lead });
  } catch (err: any) {
    console.error('PUT /leads/:id failed', err);
    if (err?.code === 'P2025') {
      return res.status(404).json({ error: 'lead_not_found' });
    }
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
