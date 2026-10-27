import { addDays, format, parseISO, startOfDay, subDays } from "date-fns";
import { Rng } from "./rng";
import {
  AVATAR_TOKENS,
  CONTRACTOR_COMPANIES,
  GIVEN_NAMES_F,
  GIVEN_NAMES_M,
  JOB_TITLES,
  QUALIFICATION_CATALOGUE,
  SURNAMES,
} from "./names";
import { generateRotationDays, isShift, isTravel, resolveShiftWindow } from "@/lib/roster/rotation";
import type {
  AccommodationBooking,
  AuditLog,
  Bed,
  Building,
  Camp,
  Employee,
  ISODate,
  LeaveRequest,
  OrgUnit,
  OrgUnitType,
  Organization,
  Position,
  PositionAssignment,
  Room,
  RosterAssignment,
  RosterPattern,
  RosterPeriod,
  RotationSlot,
  ShiftTemplate,
  Site,
  User,
} from "./schema";

export interface Database {
  organizations: Organization[];
  sites: Site[];
  orgUnitTypes: OrgUnitType[];
  orgUnits: OrgUnit[];
  positions: Position[];
  positionAssignments: PositionAssignment[];
  employees: Employee[];
  shiftTemplates: ShiftTemplate[];
  rosterPatterns: RosterPattern[];
  rosterPeriods: RosterPeriod[];
  rosterAssignments: RosterAssignment[];
  leaveRequests: LeaveRequest[];
  camps: Camp[];
  buildings: Building[];
  rooms: Room[];
  beds: Bed[];
  accommodationBookings: AccommodationBooking[];
  users: User[];
  auditLogs: AuditLog[];
}

const ORG_A = "org_oyutolgoi";
const ORG_B = "org_erdenet";
const TZ = "Asia/Ulaanbaatar";

const d = (date: Date): ISODate => format(date, "yyyy-MM-dd");

/* ---------------------------------------------------------------- org tree -- */

interface UnitSpec {
  code: string;
  name: string;
  type: string;
  children?: UnitSpec[];
}

const OT_TREE: UnitSpec = {
  code: "OT",
  name: "Оюу Толгой ХХК",
  type: "COMPANY",
  children: [
    {
      code: "MIN",
      name: "Уул уурхайн газар",
      type: "DIVISION",
      children: [
        {
          code: "MIN-OP",
          name: "Нээлттэй уурхайн хэлтэс",
          type: "DEPARTMENT",
          children: [
            {
              code: "MIN-OP-DB",
              name: "Өрөмдлөг тэсэлгээний алба",
              type: "SECTION",
              children: [
                { code: "MIN-OP-DB-A", name: "Өрөмдлөгийн баг А", type: "TEAM" },
                { code: "MIN-OP-DB-B", name: "Өрөмдлөгийн баг Б", type: "TEAM" },
              ],
            },
            {
              code: "MIN-OP-HL",
              name: "Ачилт тээвэрлэлтийн алба",
              type: "SECTION",
              children: [
                { code: "MIN-OP-HL-A", name: "Ачилтын баг А", type: "TEAM" },
                { code: "MIN-OP-HL-B", name: "Ачилтын баг Б", type: "TEAM" },
                { code: "MIN-OP-HL-C", name: "Ачилтын баг В", type: "TEAM" },
              ],
            },
          ],
        },
        {
          code: "MIN-UG",
          name: "Далд уурхайн хэлтэс",
          type: "DEPARTMENT",
          children: [
            {
              code: "MIN-UG-DV",
              name: "Хэвтээ малталтын алба",
              type: "SECTION",
              children: [
                { code: "MIN-UG-DV-A", name: "Малталтын баг А", type: "TEAM" },
                { code: "MIN-UG-DV-B", name: "Малталтын баг Б", type: "TEAM" },
              ],
            },
            { code: "MIN-UG-HO", name: "Босоо амны алба", type: "SECTION" },
          ],
        },
        { code: "MIN-GE", name: "Геологи, маркшейдерийн хэлтэс", type: "DEPARTMENT" },
      ],
    },
    {
      code: "PRC",
      name: "Боловсруулах үйлдвэрийн газар",
      type: "DIVISION",
      children: [
        {
          code: "PRC-CN",
          name: "Баяжуулах хэлтэс",
          type: "DEPARTMENT",
          children: [
            { code: "PRC-CN-A", name: "Баяжуулалтын ээлж А", type: "TEAM" },
            { code: "PRC-CN-B", name: "Баяжуулалтын ээлж Б", type: "TEAM" },
          ],
        },
        { code: "PRC-LB", name: "Лабораторийн хэлтэс", type: "DEPARTMENT" },
      ],
    },
    {
      code: "TEC",
      name: "Техник үйлчилгээний газар",
      type: "DIVISION",
      children: [
        { code: "TEC-MN", name: "Механикийн хэлтэс", type: "DEPARTMENT" },
        { code: "TEC-EL", name: "Цахилгааны хэлтэс", type: "DEPARTMENT" },
        { code: "TEC-WS", name: "Засварын цехийн хэлтэс", type: "DEPARTMENT" },
      ],
    },
    {
      code: "INF",
      name: "Дэд бүтэц, кэмпийн газар",
      type: "DIVISION",
      children: [
        {
          code: "INF-CS",
          name: "Кэмпийн үйлчилгээний хэлтэс",
          type: "DEPARTMENT",
          children: [
            { code: "INF-CS-CT", name: "Хоол үйлдвэрлэлийн алба", type: "SECTION" },
            { code: "INF-CS-HK", name: "Аж ахуйн алба", type: "SECTION" },
          ],
        },
        { code: "INF-TR", name: "Тээврийн хэлтэс", type: "DEPARTMENT" },
        { code: "INF-UT", name: "Инженерийн хангамжийн хэлтэс", type: "DEPARTMENT" },
      ],
    },
    {
      code: "HSE",
      name: "Аюулгүй байдал, эрүүл мэндийн газар",
      type: "DIVISION",
      children: [
        { code: "HSE-SF", name: "Хөдөлмөрийн аюулгүй байдлын хэлтэс", type: "DEPARTMENT" },
        { code: "HSE-MD", name: "Эмнэлгийн хэлтэс", type: "DEPARTMENT" },
      ],
    },
    {
      code: "ADM",
      name: "Захиргаа, хүний нөөцийн газар",
      type: "DIVISION",
      children: [
        { code: "ADM-HR", name: "Хүний нөөцийн хэлтэс", type: "DEPARTMENT" },
        { code: "ADM-FN", name: "Санхүүгийн хэлтэс", type: "DEPARTMENT" },
        { code: "ADM-IT", name: "Мэдээллийн технологийн хэлтэс", type: "DEPARTMENT" },
      ],
    },
  ],
};

const ER_TREE: UnitSpec = {
  code: "ER",
  name: "Эрдэнэт Үйлдвэр ТӨҮГ",
  type: "COMPANY",
  children: [
    { code: "ER-MIN", name: "Уурхайн газар", type: "DIVISION" },
    { code: "ER-ADM", name: "Захиргааны газар", type: "DIVISION" },
  ],
};

/* ------------------------------------------------------------------- build -- */

export function buildSeed(): Database {
  const rng = new Rng(20261027);
  const today = startOfDay(new Date());

  const db: Database = {
    organizations: [],
    sites: [],
    orgUnitTypes: [],
    orgUnits: [],
    positions: [],
    positionAssignments: [],
    employees: [],
    shiftTemplates: [],
    rosterPatterns: [],
    rosterPeriods: [],
    rosterAssignments: [],
    leaveRequests: [],
    camps: [],
    buildings: [],
    rooms: [],
    beds: [],
    accommodationBookings: [],
    users: [],
    auditLogs: [],
  };

  /* -- organizations ----------------------------------------------------- */
  db.organizations.push(
    { id: ORG_A, name: "Оюу Толгой ХХК", slug: "oyu-tolgoi", timezone: TZ, defaultLocale: "mn", status: "active" },
    // Exists so cross-tenant isolation is exercised by real data, not a mock.
    { id: ORG_B, name: "Эрдэнэт Үйлдвэр ТӨҮГ", slug: "erdenet", timezone: TZ, defaultLocale: "mn", status: "active" },
  );

  /* -- sites ------------------------------------------------------------- */
  db.sites.push(
    { id: "site_ot_mine", organizationId: ORG_A, code: "OT-MINE", name: "Оюу Толгой уурхай", timezone: TZ, status: "active" },
    { id: "site_ot_ub", organizationId: ORG_A, code: "UB-HQ", name: "Улаанбаатар төв оффис", timezone: TZ, status: "active" },
    { id: "site_ot_gs", organizationId: ORG_A, code: "GS-LOG", name: "Гашуун сухайт логистик", timezone: TZ, status: "active" },
    { id: "site_er_mine", organizationId: ORG_B, code: "ER-MINE", name: "Эрдэнэт уурхай", timezone: TZ, status: "active" },
  );

  /* -- unit types -------------------------------------------------------- */
  const UNIT_TYPES: [string, string, boolean][] = [
    ["COMPANY", "Компани", false],
    ["DIVISION", "Газар", false],
    ["DEPARTMENT", "Хэлтэс", true],
    ["SECTION", "Алба", true],
    ["TEAM", "Баг", true],
  ];
  for (const orgId of [ORG_A, ORG_B]) {
    UNIT_TYPES.forEach(([code, name, isAssignable], i) => {
      db.orgUnitTypes.push({
        id: `ut_${orgId}_${code}`,
        organizationId: orgId,
        code,
        name,
        isAssignable,
        sortOrder: i,
      });
    });
  }

  /* -- org units --------------------------------------------------------- */
  const flattenTree = (spec: UnitSpec, orgId: string, parentId: string | null, path: string, depth: number, sortOrder: number) => {
    const id = `ou_${orgId}_${spec.code}`;
    db.orgUnits.push({
      id,
      organizationId: orgId,
      parentId,
      unitTypeId: `ut_${orgId}_${spec.type}`,
      code: spec.code,
      name: spec.name,
      status: "active",
      sortOrder,
      path,
      depth,
      headcountTarget: spec.type === "TEAM" ? rng.int(18, 44) : null,
    });
    spec.children?.forEach((child, i) => {
      flattenTree(child, orgId, id, `${path}.${i + 1}`, depth + 1, i);
    });
  };
  flattenTree(OT_TREE, ORG_A, null, "1", 0, 0);
  flattenTree(ER_TREE, ORG_B, null, "1", 0, 0);

  /* -- positions --------------------------------------------------------- */
  const POSITION_SPECS: [string, string, string, string][] = [
    ["POS-GM", "Гүйцэтгэх захирал", "Удирдлага", "E1"],
    ["POS-DIR", "Газрын захирал", "Удирдлага", "E2"],
    ["POS-HOD", "Хэлтсийн дарга", "Удирдлага", "M1"],
    ["POS-SUP", "Албаны дарга", "Удирдлага", "M2"],
    ["POS-LEAD", "Ээлжийн ахлах", "Удирдлага", "M3"],
    ["POS-ENG1", "Ахлах инженер", "Инженер", "P1"],
    ["POS-ENG2", "Инженер", "Инженер", "P2"],
    ["POS-GEO", "Геологич", "Инженер", "P2"],
    ["POS-SURV", "Маркшейдер", "Инженер", "P2"],
    ["POS-OP1", "Ахлах оператор", "Үйл ажиллагаа", "O1"],
    ["POS-OP2", "Оператор", "Үйл ажиллагаа", "O2"],
    ["POS-DRV", "Жолооч", "Үйл ажиллагаа", "O2"],
    ["POS-MECH", "Механикч", "Техник", "T1"],
    ["POS-ELEC", "Цахилгаанчин", "Техник", "T1"],
    ["POS-WELD", "Гагнуурчин", "Техник", "T2"],
    ["POS-HSE", "АБ-ЭМ-ын мэргэжилтэн", "Дэмжлэг", "S1"],
    ["POS-MED", "Эмч", "Дэмжлэг", "S1"],
    ["POS-HR", "Хүний нөөцийн мэргэжилтэн", "Дэмжлэг", "S2"],
    ["POS-FIN", "Санхүүгийн мэргэжилтэн", "Дэмжлэг", "S2"],
    ["POS-IT", "МТ-ийн мэргэжилтэн", "Дэмжлэг", "S2"],
    ["POS-CHEF", "Тогооч", "Үйлчилгээ", "C1"],
    ["POS-HK", "Үйлчлэгч", "Үйлчилгээ", "C2"],
    ["POS-STORE", "Нярав", "Дэмжлэг", "S3"],
  ];
  for (const orgId of [ORG_A, ORG_B]) {
    for (const [code, title, jobFamily, grade] of POSITION_SPECS) {
      db.positions.push({ id: `pos_${orgId}_${code}`, organizationId: orgId, code, title, jobFamily, grade });
    }
  }

  /* -- shift templates --------------------------------------------------- */
  const SHIFTS: [string, string, string, string, number, ShiftTemplate["shiftType"], ShiftTemplate["colorToken"]][] = [
    ["DAY12", "Өдрийн ээлж 12ц", "07:00", "19:00", 60, "day", "accent"],
    ["NIGHT12", "Шөнийн ээлж 12ц", "19:00", "07:00", 60, "night", "plan"],
    ["OFFICE", "Оффисын цаг", "09:00", "18:00", 60, "day", "neutral"],
    ["SWING", "Завсрын ээлж", "13:00", "01:00", 45, "swing", "warn"],
    ["STANDBY", "Бэлэн байдал", "08:00", "20:00", 0, "standby", "neutral"],
  ];
  for (const orgId of [ORG_A, ORG_B]) {
    for (const [code, name, startTime, endTime, breakMinutes, shiftType, colorToken] of SHIFTS) {
      db.shiftTemplates.push({
        id: `st_${orgId}_${code}`, organizationId: orgId, code, name,
        startTime, endTime, breakMinutes, shiftType, colorToken,
      });
    }
  }

  /* -- rotation patterns ------------------------------------------------- */
  const rest = (): RotationSlot => ({ rest: true });
  const shiftSlot = (id: string): RotationSlot => ({ shiftTemplateId: id });
  const travelIn = (): RotationSlot => ({ travel: "in" });
  const travelOut = (): RotationSlot => ({ travel: "out" });

  const buildRotation = (onDays: number, offDays: number, shiftId: string): RotationSlot[] => [
    travelIn(),
    ...Array.from({ length: onDays - 1 }, () => shiftSlot(shiftId)),
    travelOut(),
    ...Array.from({ length: offDays - 1 }, rest),
  ];

  const PATTERNS: [string, string, RotationSlot[]][] = [
    ["R14-14-D", "14/14 өдрийн ээлж", buildRotation(14, 14, `st_${ORG_A}_DAY12`)],
    ["R14-14-N", "14/14 шөнийн ээлж", buildRotation(14, 14, `st_${ORG_A}_NIGHT12`)],
    ["R14-7", "14/7 өдрийн ээлж", buildRotation(14, 7, `st_${ORG_A}_DAY12`)],
    ["R20-10", "20/10 өдрийн ээлж", buildRotation(20, 10, `st_${ORG_A}_DAY12`)],
    [
      "R5-2",
      "5/2 оффисын цаг",
      [
        ...Array.from({ length: 5 }, () => shiftSlot(`st_${ORG_A}_OFFICE`)),
        rest(),
        rest(),
      ],
    ],
  ];
  for (const [code, name, configuration] of PATTERNS) {
    db.rosterPatterns.push({
      id: `rp_${ORG_A}_${code}`,
      organizationId: ORG_A,
      code,
      name,
      cycleLength: configuration.length,
      configuration,
    });
  }

  /* -- camps, buildings, rooms, beds ------------------------------------- */
  const CAMP_SPECS: [string, string, string, string, number][] = [
    ["camp_ot_main", "site_ot_mine", "OT-C1", "Оюу Толгой гол кэмп", 6],
    ["camp_ot_west", "site_ot_mine", "OT-C2", "Баруун кэмп", 4],
    ["camp_gs", "site_ot_gs", "GS-C1", "Гашуун сухайтын кэмп", 2],
  ];
  for (const [campId, siteId, code, name, buildingCount] of CAMP_SPECS) {
    db.camps.push({ id: campId, organizationId: ORG_A, siteId, code, name, status: "active" });

    for (let b = 0; b < buildingCount; b++) {
      const buildingId = `${campId}_b${b + 1}`;
      const floorCount = rng.int(2, 3);
      db.buildings.push({
        id: buildingId,
        organizationId: ORG_A,
        campId,
        code: `${code}-B${b + 1}`,
        name: `${b + 1}-р байр`,
        floorCount,
      });

      for (let f = 1; f <= floorCount; f++) {
        const roomsOnFloor = rng.int(10, 14);
        for (let r = 1; r <= roomsOnFloor; r++) {
          const roomType = rng.weighted([
            ["double", 5], ["twin", 3], ["single", 2], ["quad", 1],
          ] as const) as Room["roomType"];
          const capacity = roomType === "single" ? 1 : roomType === "quad" ? 4 : 2;
          const roomStatus = rng.weighted([
            ["available", 94], ["maintenance", 4], ["out_of_service", 2],
          ] as const) as Room["status"];
          const roomId = `${buildingId}_f${f}r${r}`;

          db.rooms.push({
            id: roomId,
            organizationId: ORG_A,
            campId,
            buildingId,
            floor: f,
            roomNumber: `${f}${String(r).padStart(2, "0")}`,
            roomType,
            capacity,
            status: roomStatus,
            housekeeping: rng.weighted([["clean", 8], ["dirty", 2], ["in_progress", 1]] as const) as Room["housekeeping"],
            genderPolicy: rng.weighted([["any", 6], ["male", 3], ["female", 2]] as const) as Room["genderPolicy"],
          });

          for (let bed = 1; bed <= capacity; bed++) {
            db.beds.push({
              id: `${roomId}_bed${bed}`,
              organizationId: ORG_A,
              campId,
              buildingId,
              roomId,
              bedCode: `${f}${String(r).padStart(2, "0")}-${String.fromCharCode(64 + bed)}`,
              status:
                roomStatus === "out_of_service"
                  ? "out_of_service"
                  : roomStatus === "maintenance"
                    ? "maintenance"
                    : rng.bool(0.02)
                      ? "maintenance"
                      : "available",
            });
          }
        }
      }
    }
  }

  /* -- employees --------------------------------------------------------- */
  // Employees attach to leaf units only — a DIVISION holds departments, not people.
  const leafUnitsA = db.orgUnits.filter(
    (u) =>
      u.organizationId === ORG_A &&
      !db.orgUnits.some((c) => c.parentId === u.id),
  );
  const positionsA = db.positions.filter((p) => p.organizationId === ORG_A);
  const campsA = db.camps.map((c) => c.id);

  const makeEmployee = (i: number, orgId: string, units: OrgUnit[]): Employee => {
    const isMale = rng.bool(0.78); // mining site demographics
    const given = isMale ? rng.pick(GIVEN_NAMES_M) : rng.pick(GIVEN_NAMES_F);
    const surname = rng.pick(SURNAMES);
    const unit = rng.pick(units);
    const position = rng.pick(positionsA);
    const employmentType = rng.weighted([
      ["employee", 70], ["contractor", 20], ["subcontractor", 10],
    ] as const) as Employee["employmentType"];
    const status = rng.weighted([
      ["active", 92], ["on_leave", 6], ["suspended", 1], ["terminated", 1],
    ] as const) as Employee["status"];
    const siteId = rng.weighted([
      ["site_ot_mine", 75], ["site_ot_ub", 15], ["site_ot_gs", 10],
    ] as const) as string;
    const rostered = siteId !== "site_ot_ub";
    const patternId = rostered
      ? rng.weighted([
          [`rp_${ORG_A}_R14-14-D`, 40],
          [`rp_${ORG_A}_R14-14-N`, 25],
          [`rp_${ORG_A}_R14-7`, 20],
          [`rp_${ORG_A}_R20-10`, 15],
        ] as const) as string
      : `rp_${ORG_A}_R5-2`;

    const code = `${orgId === ORG_A ? "OT" : "ER"}-${String(10000 + i)}`;
    const quals = rng.sample(QUALIFICATION_CATALOGUE, rng.int(2, 5)).map((q) => ({
      code: q.code,
      name: q.name,
      issuedAt: d(subDays(today, rng.int(200, 1400))),
      // A slice expire soon or have lapsed — the compliance view needs teeth.
      expiresAt: rng.bool(0.12) ? d(subDays(today, rng.int(1, 60))) : d(addDays(today, rng.int(20, 900))),
    }));

    return {
      id: `emp_${orgId}_${i}`,
      organizationId: orgId,
      employeeCode: code,
      firstName: given,
      lastName: surname,
      displayName: `${surname.charAt(0)}.${given}`,
      avatarColor: rng.pick(AVATAR_TOKENS),
      status,
      employmentType,
      jobTitle: rng.pick(JOB_TITLES),
      positionId: position.id,
      orgUnitId: unit.id,
      orgUnitPath: unit.path,
      siteId,
      campId: rostered ? rng.pick(campsA) : null,
      legalEmployerId: employmentType === "employee" ? orgId : null,
      contractorCompany: employmentType === "employee" ? null : rng.pick(CONTRACTOR_COMPANIES),
      workPhone: `+976 ${rng.int(8800, 9999)} ${rng.int(1000, 9999)}`,
      workEmail: `${code.toLowerCase()}@oyutolgoi.mn`,
      supervisorId: null,
      hiredAt: d(subDays(today, rng.int(90, 3600))),
      rotationPatternId: patternId,
      // Per-employee anchor: crews on the same pattern are deliberately
      // out of phase, exactly as they are on a real site.
      rotationAnchorDate: d(subDays(today, rng.int(0, 27))),
      qualifications: quals,

      nationalId: `${rng.pick(["АА", "УБ", "ЧД", "БЗ", "СБ"])}${rng.int(10000000, 99999999)}`,
      passportNo: rng.bool(0.3) ? `E${rng.int(1000000, 9999999)}` : null,
      dateOfBirth: d(subDays(today, rng.int(7500, 21000))),
      personalPhone: `+976 ${rng.int(8000, 9999)} ${rng.int(1000, 9999)}`,
      personalEmail: rng.bool(0.5) ? `${given.toLowerCase()}${rng.int(10, 99)}@gmail.com` : null,
      homeAddress: `Улаанбаатар, ${rng.pick(["Баянзүрх", "Сүхбаатар", "Чингэлтэй", "Хан-Уул", "Сонгинохайрхан"])} дүүрэг, ${rng.int(1, 25)}-р хороо`,
      emergencyContactName: `${rng.pick(SURNAMES).charAt(0)}.${rng.pick([...GIVEN_NAMES_M, ...GIVEN_NAMES_F])}`,
      emergencyContactPhone: `+976 ${rng.int(8000, 9999)} ${rng.int(1000, 9999)}`,
      emergencyContactRelation: rng.pick(["Эхнэр", "Нөхөр", "Эцэг", "Эх", "Ах", "Эгч", "Дүү"]),
      medicalNotes: rng.bool(0.15) ? rng.pick(["Пенициллинд харшилтай", "Хоолны зохицуулалт шаардлагатай", "Даралт ихсэлттэй, хяналтад байдаг"]) : null,
      bankAccount: `${rng.int(5000, 5999)}${rng.int(100000, 999999)}`,
      salaryGrade: position.grade,
    };
  };

  for (let i = 1; i <= 1240; i++) db.employees.push(makeEmployee(i, ORG_A, leafUnitsA));

  const leafUnitsB = db.orgUnits.filter(
    (u) => u.organizationId === ORG_B && !db.orgUnits.some((c) => c.parentId === u.id),
  );
  for (let i = 1; i <= 60; i++) db.employees.push(makeEmployee(i, ORG_B, leafUnitsB));

  /* -- supervisors & position assignments -------------------------------- */
  const employeesByUnit = new Map<string, Employee[]>();
  for (const e of db.employees) {
    if (!e.orgUnitId) continue;
    const list = employeesByUnit.get(e.orgUnitId) ?? [];
    list.push(e);
    employeesByUnit.set(e.orgUnitId, list);
  }

  for (const [unitId, members] of employeesByUnit) {
    const unit = db.orgUnits.find((u) => u.id === unitId)!;
    const lead = members[0];
    for (const e of members) {
      if (e.id !== lead.id) e.supervisorId = lead.id;
      db.positionAssignments.push({
        id: `pa_${e.id}`,
        organizationId: e.organizationId,
        employeeId: e.id,
        orgUnitId: unitId,
        orgUnitPath: unit.path,
        positionId: e.positionId!,
        reportsToAssignmentId: e.id === lead.id ? null : `pa_${lead.id}`,
        effectiveFrom: e.hiredAt,
        effectiveTo: null,
        isPrimary: true,
      });
    }
  }

  /* -- roster periods & assignments -------------------------------------- */
  const PERIOD_LENGTH = 28;
  const currentStart = subDays(today, 7);
  const periodSpecs: [string, Date, RosterPeriod["status"], number][] = [
    ["Өмнөх мөчлөг", subDays(currentStart, PERIOD_LENGTH), "published", 3],
    ["Идэвхтэй мөчлөг", currentStart, "published", 2],
    ["Дараагийн мөчлөг", addDays(currentStart, PERIOD_LENGTH), "draft", 1],
  ];

  const rosteredEmployees = db.employees.filter(
    (e) => e.organizationId === ORG_A && e.siteId !== "site_ot_ub" && e.status !== "terminated",
  );
  const patternById = new Map(db.rosterPatterns.map((p) => [p.id, p]));
  const shiftById = new Map(db.shiftTemplates.map((s) => [s.id, s]));

  periodSpecs.forEach(([name, start, status, version], pi) => {
    const end = addDays(start, PERIOD_LENGTH - 1);
    const periodId = `rpd_${ORG_A}_${pi}`;
    db.rosterPeriods.push({
      id: periodId,
      organizationId: ORG_A,
      siteId: "site_ot_mine",
      name,
      startDate: d(start),
      endDate: d(end),
      status,
      version,
      publishedAt: status === "published" ? subDays(start, 5).toISOString() : null,
      publishedBy: status === "published" ? "user_approver" : null,
      createdAt: subDays(start, 14).toISOString(),
    });

    for (const emp of rosteredEmployees) {
      const pattern = patternById.get(emp.rotationPatternId!);
      if (!pattern || !emp.rotationAnchorDate) continue;

      const days = generateRotationDays({
        configuration: pattern.configuration,
        anchorDate: emp.rotationAnchorDate,
        rangeStart: d(start),
        rangeEnd: d(end),
      });

      for (const day of days) {
        let dayType: RosterAssignment["dayType"] = "rest";
        let shiftTemplateId: string | null = null;
        let startAt: string | null = null;
        let endAt: string | null = null;

        if (isShift(day.slot)) {
          dayType = "shift";
          shiftTemplateId = day.slot.shiftTemplateId;
          const tpl = shiftById.get(shiftTemplateId);
          if (tpl) {
            const w = resolveShiftWindow(day.date, tpl, TZ);
            startAt = w.startAt;
            endAt = w.endAt;
          }
        } else if (isTravel(day.slot)) {
          dayType = day.slot.travel === "in" ? "travel_in" : "travel_out";
        }

        // Rest days are not stored — absence of a row IS the rest day. Storing
        // them would triple the table for no information gain.
        if (dayType === "rest") continue;

        db.rosterAssignments.push({
          id: `ra_${periodId}_${emp.id}_${day.date}`,
          organizationId: ORG_A,
          rosterPeriodId: periodId,
          employeeId: emp.id,
          orgUnitPath: emp.orgUnitPath,
          siteId: emp.siteId!,
          date: day.date,
          shiftTemplateId,
          dayType,
          startAt,
          endAt,
          status: status === "published" ? "confirmed" : "planned",
          source: "generated",
          note: null,
        });
      }
    }
  });

  /* -- leave requests ---------------------------------------------------- */
  const LEAVE_TYPES: LeaveRequest["leaveType"][] = ["annual", "sick", "unpaid", "parental", "training", "compassionate"];
  for (let i = 0; i < 120; i++) {
    const emp = rng.pick(rosteredEmployees);
    const start = addDays(today, rng.int(-30, 45));
    const days = rng.int(1, 12);
    const status = rng.weighted([
      ["approved", 55], ["pending", 30], ["rejected", 8], ["cancelled", 7],
    ] as const) as LeaveRequest["status"];
    db.leaveRequests.push({
      id: `lr_${ORG_A}_${i}`,
      organizationId: ORG_A,
      employeeId: emp.id,
      orgUnitPath: emp.orgUnitPath,
      startAt: startOfDay(start).toISOString(),
      endAt: startOfDay(addDays(start, days)).toISOString(),
      leaveType: rng.pick(LEAVE_TYPES),
      status,
      reason: rng.pick(["Гэр бүлийн шалтгаан", "Эмнэлгийн үзлэг", "Хувийн ажил", "Сургалт", "Амралт", null]),
      requestedAt: subDays(start, rng.int(3, 40)).toISOString(),
      decidedBy: status === "pending" ? null : "user_supervisor",
      decidedAt: status === "pending" ? null : subDays(start, rng.int(1, 3)).toISOString(),
      decisionReason: status === "rejected" ? "Тухайн хугацаанд хүн хүрэлцэхгүй." : null,
    });
  }

  /* -- accommodation bookings -------------------------------------------- */
  const availableBeds = db.beds.filter((b) => b.status === "available");
  const bedsByCamp = new Map<string, Bed[]>();
  for (const b of availableBeds) {
    const list = bedsByCamp.get(b.campId) ?? [];
    list.push(b);
    bedsByCamp.set(b.campId, list);
  }

  let bookingSeq = 0;
  for (const [campId, beds] of bedsByCamp) {
    // Fill roughly 70% of each camp so "free beds" is a real, non-zero number.
    const occupancy = rng.float() * 0.18 + 0.62;
    const chosen = rng.sample(beds, Math.floor(beds.length * occupancy));

    for (const bed of chosen) {
      const candidates = rosteredEmployees.filter((e) => e.campId === campId);
      if (!candidates.length) continue;
      const emp = rng.pick(candidates);

      const startOffset = rng.int(-12, 2);
      const length = rng.int(7, 21);
      const start = startOfDay(addDays(today, startOffset));
      const end = startOfDay(addDays(start, length));

      // Planned vs actual are decided independently — a reservation whose
      // window has begun is NOT automatically a check-in.
      const started = startOffset <= 0;
      const status: AccommodationBooking["status"] = started
        ? rng.weighted([["checked_in", 80], ["reserved", 12], ["no_show", 8]] as const) as AccommodationBooking["status"]
        : "reserved";

      db.accommodationBookings.push({
        id: `ab_${ORG_A}_${bookingSeq++}`,
        organizationId: ORG_A,
        campId,
        buildingId: bed.buildingId,
        roomId: bed.roomId,
        bedId: bed.id,
        personType: "employee",
        employeeId: emp.id,
        visitorId: null,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        status,
        checkedInAt: status === "checked_in" ? addDays(start, 0).toISOString() : null,
        checkedInBy: status === "checked_in" ? "user_camp" : null,
        checkedOutAt: null,
        checkedOutBy: null,
        createdAt: subDays(start, rng.int(2, 20)).toISOString(),
        createdBy: "user_camp",
        idempotencyKey: null,
        note: null,
      });
    }
  }

  /* -- users ------------------------------------------------------------- */
  const sectionUnit = db.orgUnits.find((u) => u.code === "MIN-OP-HL")!;
  const selfEmployee = db.employees.find(
    (e) => e.organizationId === ORG_A && e.orgUnitPath?.startsWith(sectionUnit.path),
  )!;

  const DEMO_USERS: [string, string, string, string[], Partial<{ campIds: string[]; siteIds: string[]; orgUnitPath: string; employeeId: string }>][] = [
    ["user_admin", "admin@campos.mn", "Б.Алтанзул", ["org.admin"], {}],
    ["user_hr", "hr@campos.mn", "Д.Оюунчимэг", ["hr.manager"], {}],
    ["user_designer", "designer@campos.mn", "Ц.Нарантуяа", ["org.designer"], {}],
    ["user_planner", "planner@campos.mn", "Г.Батбаяр", ["roster.planner"], {}],
    ["user_approver", "approver@campos.mn", "Э.Мөнхбат", ["roster.approver"], {}],
    ["user_camp", "camp@campos.mn", "С.Болормаа", ["camp.manager"], { campIds: ["camp_ot_main", "camp_ot_west"] }],
    ["user_transport", "transport@campos.mn", "Л.Ганзориг", ["transport.coordinator"], {}],
    ["user_boarding", "boarding@campos.mn", "Н.Жавхлан", ["boarding.agent"], {}],
    ["user_reception", "reception@campos.mn", "Б.Хонгорзул", ["reception.officer"], { siteIds: ["site_ot_mine"] }],
    ["user_gate", "gate@campos.mn", "Ч.Хүрэлбаатар", ["security.gate"], { siteIds: ["site_ot_mine"] }],
    ["user_supervisor", "supervisor@campos.mn", "П.Эрдэнэбат", ["supervisor"], { orgUnitPath: sectionUnit.path }],
    ["user_employee", "employee@campos.mn", selfEmployee.displayName, ["employee"], { employeeId: selfEmployee.id }],
    ["user_auditor", "auditor@campos.mn", "Ж.Сувдаа", ["auditor"], {}],
  ];

  for (const [id, email, name, roleIds, scope] of DEMO_USERS) {
    db.users.push({
      id,
      email,
      name,
      avatarColor: rng.pick(AVATAR_TOKENS),
      devPassword: "demo",
      isPlatformAdmin: false,
      permVersion: 1,
      status: "active",
      memberships: [
        {
          organizationId: ORG_A,
          roleIds,
          employeeId: scope.employeeId ?? null,
          siteIds: scope.siteIds ?? [],
          campIds: scope.campIds ?? [],
          orgUnitPath: scope.orgUnitPath ?? null,
        },
      ],
    });
  }

  db.users.push({
    id: "user_platform",
    email: "platform@campos.mn",
    name: "Системийн админ",
    avatarColor: "accent",
    devPassword: "demo",
    isPlatformAdmin: true,
    permVersion: 1,
    status: "active",
    memberships: [
      { organizationId: ORG_A, roleIds: ["platform.superadmin"], employeeId: null, siteIds: [], campIds: [], orgUnitPath: null },
      { organizationId: ORG_B, roleIds: ["platform.superadmin"], employeeId: null, siteIds: [], campIds: [], orgUnitPath: null },
    ],
  });

  // Belongs to the other tenant only. Used to prove isolation end to end.
  db.users.push({
    id: "user_erdenet",
    email: "erdenet@campos.mn",
    name: "Эрдэнэтийн админ",
    avatarColor: "warn",
    devPassword: "demo",
    isPlatformAdmin: false,
    permVersion: 1,
    status: "active",
    memberships: [
      { organizationId: ORG_B, roleIds: ["org.admin"], employeeId: null, siteIds: [], campIds: [], orgUnitPath: null },
    ],
  });

  return db;
}

export const SEED_ORG_A = ORG_A;
export const SEED_ORG_B = ORG_B;
