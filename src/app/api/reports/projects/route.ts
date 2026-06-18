// src/app/api/reports/projects/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import ExcelJS from "exceljs";

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") || "json";

  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { name: true } },
      _count: { select: { teamMembers: true, components: true } },
    },
  });

  const totalRevenue = projects.reduce((s, p) => s + p.clientPayment, 0);
  const totalCost = projects.reduce((s, p) => s + p.totalCost, 0);
  const totalProfit = projects.reduce((s, p) => s + p.profit, 0);

  if (format === "excel") {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Project Report");
    sheet.columns = [
      { header: "Project ID", key: "projectId", width: 14 },
      { header: "Name", key: "name", width: 25 },
      { header: "Status", key: "status", width: 14 },
      { header: "Manager", key: "manager", width: 20 },
      { header: "Team", key: "team", width: 8 },
      { header: "Components", key: "components", width: 12 },
      { header: "Revenue (PKR)", key: "revenue", width: 16 },
      { header: "Cost (PKR)", key: "cost", width: 16 },
      { header: "Profit (PKR)", key: "profit", width: 16 },
    ];
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3B82F6" } };
    headerRow.alignment = { horizontal: "center", vertical: "middle" };

    for (const p of projects) {
      sheet.addRow({
        projectId: p.projectId,
        name: p.name,
        status: p.status,
        manager: p.user.name,
        team: p._count.teamMembers,
        components: p._count.components,
        revenue: p.clientPayment,
        cost: p.totalCost,
        profit: p.profit,
      });
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return new NextResponse(buffer, {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=project-report.xlsx" },
    });
  }

  return NextResponse.json({
    projects: JSON.parse(JSON.stringify(projects)),
    totalRevenue, totalCost, totalProfit,
  });
}