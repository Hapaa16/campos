import { addDays, format, startOfDay, subDays } from "date-fns";
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
import { ROLE_DEFINITIONS } from "@/lib/authz/roles";
import type { RoleDefinition } from "@/lib/authz/types";
import type {
  AccommodationBooking,
  AttendanceCorrection,
  AttendanceEvent,
  BoardingRecord,
  Driver,
  TransportBooking,
  TransportIncident,
  TransportPassenger,
  TransportRoute,
  TransportStop,
  TransportTrip,
  Vehicle,
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
  /**
   * Editable copy of the seeded roles.
   *
   * Roles are data, so they live in the store rather than in code — editing
   * one in Settings must not require a deploy.
   */
  roles: RoleDefinition[];
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
  attendanceEvents: AttendanceEvent[];
  attendanceCorrections: AttendanceCorrection[];
  vehicles: Vehicle[];
  drivers: Driver[];
  transportRoutes: TransportRoute[];
  transportStops: TransportStop[];
  transportTrips: TransportTrip[];
  transportBookings: TransportBooking[];
  transportPassengers: TransportPassenger[];
  boardingRecords: BoardingRecord[];
  transportIncidents: TransportIncident[];
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
    // Deep-cloned so an edit at runtime cannot mutate the seeded constants
    // that the tests and the ability builder's default fall back to.
    roles: structuredClone(ROLE_DEFINITIONS),
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
    attendanceEvents: [],
    attendanceCorrections: [],
    vehicles: [],
    drivers: [],
    transportRoutes: [],
    transportStops: [],
    transportTrips: [],
    transportBookings: [],
    transportPassengers: [],
    boardingRecords: [],
    transportIncidents: [],
    users: [],
    auditLogs: [],
  };

  /* -- organizations ----------------------------------------------------- */
  db.organizations.push(
    {
      id: ORG_A,
      name: "Оюу Толгой ХХК",
      slug: "oyu-tolgoi",
      timezone: TZ,
      defaultLocale: "mn",
      status: "active",
      attendanceGraceMinutes: 10,
      earlyLeaveGraceMinutes: 10,
    },
    // Exists so cross-tenant isolation is exercised by real data, not a mock.
    {
      id: ORG_B,
      name: "Эрдэнэт Үйлдвэр ТӨҮГ",
      slug: "erdenet",
      timezone: TZ,
      defaultLocale: "mn",
      status: "active",
      attendanceGraceMinutes: 15,
      earlyLeaveGraceMinutes: 15,
    },
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

  /* -- leave that lands on a rostered shift --------------------------------
     Leave approved AFTER the roster was published is routine, and it is the
     only way the "excused, not absent" path gets exercised. Without it the
     roster and the leave register never disagree, which is not how a real
     site behaves. */
  const recentShifts = db.rosterAssignments.filter(
    (a) => a.dayType === "shift" && a.date <= d(today) && a.date >= d(subDays(today, 10)),
  );
  for (let i = 0; i < 16 && recentShifts.length > 0; i++) {
    const assignment = rng.pick(recentShifts);
    const employee = db.employees.find((e) => e.id === assignment.employeeId);
    if (!employee) continue;

    const start = startOfDay(new Date(`${assignment.date}T00:00:00`));
    db.leaveRequests.push({
      id: `lr_${ORG_A}_late_${i}`,
      organizationId: ORG_A,
      employeeId: employee.id,
      orgUnitPath: employee.orgUnitPath,
      startAt: start.toISOString(),
      endAt: addDays(start, rng.int(1, 3)).toISOString(),
      leaveType: rng.pick(["sick", "compassionate", "annual"] as const),
      status: "approved",
      reason: rng.pick(["Эмнэлгийн магадлагаа", "Гэр бүлийн гачигдал", "Яаралтай хувийн шалтгаан"]),
      // Requested and decided after the roster was already published.
      requestedAt: subDays(start, 1).toISOString(),
      decidedBy: "user_supervisor",
      decidedAt: subDays(start, 1).toISOString(),
      decisionReason: null,
    });
  }


  /* -- attendance events --------------------------------------------------
     Clock facts for the past two weeks, generated from the published roster.

     Deliberately imperfect, because a clean dataset hides exactly the cases
     the module exists for: late arrivals, missing clock-outs, absences, and
     people who worked a shift nobody rostered them for. */
  const todayStr = d(today);
  const observedAssignments = db.rosterAssignments.filter(
    (a) =>
      a.dayType === "shift" &&
      a.startAt !== null &&
      a.endAt !== null &&
      a.date <= todayStr &&
      a.date >= d(subDays(today, 14)),
  );

  let eventSeq = 0;
  const pushEvent = (
    employeeId: string,
    siteId: string,
    eventType: AttendanceEvent["eventType"],
    occurredAt: string,
    source: AttendanceEvent["source"],
  ) => {
    db.attendanceEvents.push({
      id: `ae_${ORG_A}_${eventSeq++}`,
      organizationId: ORG_A,
      employeeId,
      siteId,
      eventType,
      occurredAt,
      source,
      deviceId: source === "terminal" ? `GATE-${rng.int(1, 4)}` : null,
      recordedBy: source === "manual" ? "user_supervisor" : null,
      attendanceRecordId: null,
      idempotencyKey: null,
    });
  };

  // People with approved leave over the shift produce no clock events — that
  // absence of evidence is exactly what "excused" has to be derived from.
  const onLeaveKeys = new Set(
    db.leaveRequests
      .filter((l) => l.status === "approved")
      .flatMap((l) => {
        const keys: string[] = [];
        for (let i = 0; i < 14; i++) {
          const day = d(addDays(new Date(l.startAt), i));
          if (new Date(`${day}T00:00:00Z`) >= new Date(l.endAt)) break;
          keys.push(`${l.employeeId}|${day}`);
        }
        return keys;
      }),
  );

  for (const assignment of observedAssignments) {
    if (onLeaveKeys.has(`${assignment.employeeId}|${assignment.date}`)) continue;

    const outcome = rng.weighted([
      ["on_time", 72],
      ["late", 12],
      ["no_clock_out", 6],
      ["early_leave", 5],
      ["absent", 5],
    ] as const);

    if (outcome === "absent") continue; // no events at all is what absence looks like

    const plannedStart = Date.parse(assignment.startAt!);
    const plannedEnd = Date.parse(assignment.endAt!);
    const source = rng.weighted([["terminal", 80], ["biometric", 15], ["manual", 5]] as const) as
      AttendanceEvent["source"];

    const inOffset =
      outcome === "late" ? rng.int(12, 95) * 60_000 : rng.int(-20, 8) * 60_000;
    pushEvent(
      assignment.employeeId,
      assignment.siteId,
      "clock_in",
      new Date(plannedStart + inOffset).toISOString(),
      source,
    );

    if (outcome === "no_clock_out") continue;

    const outOffset =
      outcome === "early_leave" ? -rng.int(35, 240) * 60_000 : rng.int(-5, 25) * 60_000;
    pushEvent(
      assignment.employeeId,
      assignment.siteId,
      "clock_out",
      new Date(plannedEnd + outOffset).toISOString(),
      source,
    );
  }

  /* A handful of people worked shifts nobody rostered them for — cover,
     callouts, and swaps that never made it into the plan. */
  const unrosteredCandidates = db.employees.filter(
    (e) => e.organizationId === ORG_A && e.siteId === "site_ot_mine" && e.status === "active",
  );
  for (let i = 0; i < 24; i++) {
    const employee = rng.pick(unrosteredCandidates);
    const date = subDays(today, rng.int(1, 12));
    const rostered = db.rosterAssignments.some(
      (a) => a.employeeId === employee.id && a.date === d(date) && a.dayType === "shift",
    );
    if (rostered) continue;

    const start = new Date(startOfDay(date).getTime() + 7 * 3_600_000);
    pushEvent(employee.id, employee.siteId!, "clock_in", start.toISOString(), "terminal");
    pushEvent(
      employee.id,
      employee.siteId!,
      "clock_out",
      new Date(start.getTime() + rng.int(8, 12) * 3_600_000).toISOString(),
      "terminal",
    );
  }

  /* A few supervisor corrections, so the override path has real data. */
  const correctable = observedAssignments.filter((a) => a.date < todayStr).slice(0, 400);
  for (let i = 0; i < 9 && i < correctable.length; i++) {
    const assignment = rng.pick(correctable);
    db.attendanceCorrections.push({
      id: `ac_${ORG_A}_${i}`,
      organizationId: ORG_A,
      employeeId: assignment.employeeId,
      siteId: assignment.siteId,
      date: assignment.date,
      status: "present",
      derivedStatus: "absent",
      reason: rng.pick([
        "Уншигч эвдэрсэн, ээлжийн ахлах биечлэн баталгаажуулсан.",
        "Картаа гэртээ мартсан, хаалганы бүртгэлээр шалгасан.",
        "Терминал тасарсан үед ажилласан.",
      ]),
      correctedBy: "user_supervisor",
      correctedAt: addDays(new Date(`${assignment.date}T12:00:00Z`), 1).toISOString(),
      note: null,
    });
  }

  /* -- transport ---------------------------------------------------------
     Real Mongolian routes with intermediate stops, because a route with only
     an origin and a destination makes segment capacity indistinguishable from
     a headcount — which is exactly the mistake the model exists to avoid. */

  const ROUTES: {
    code: string;
    name: string;
    origin: string;
    destination: string;
    durationMinutes: number;
    stops: { name: string; offset: number; siteId?: string; campId?: string }[];
  }[] = [
    {
      code: "UB-OT",
      name: "Улаанбаатар — Оюу Толгой",
      origin: "Улаанбаатар",
      destination: "Оюу Толгой",
      durationMinutes: 600,
      stops: [
        { name: "УБ — Төв оффис", offset: 0, siteId: "site_ot_ub" },
        { name: "Мандалговь", offset: 240 },
        { name: "Даланзадгад", offset: 450 },
        { name: "Оюу Толгой — гол кэмп", offset: 600, siteId: "site_ot_mine", campId: "camp_ot_main" },
      ],
    },
    {
      code: "OT-UB",
      name: "Оюу Толгой — Улаанбаатар",
      origin: "Оюу Толгой",
      destination: "Улаанбаатар",
      durationMinutes: 600,
      stops: [
        { name: "Оюу Толгой — гол кэмп", offset: 0, siteId: "site_ot_mine", campId: "camp_ot_main" },
        { name: "Даланзадгад", offset: 150 },
        { name: "Мандалговь", offset: 360 },
        { name: "УБ — Төв оффис", offset: 600, siteId: "site_ot_ub" },
      ],
    },
    {
      code: "OT-GS",
      name: "Оюу Толгой — Гашуун сухайт",
      origin: "Оюу Толгой",
      destination: "Гашуун сухайт",
      durationMinutes: 180,
      stops: [
        { name: "Оюу Толгой — гол кэмп", offset: 0, siteId: "site_ot_mine", campId: "camp_ot_main" },
        { name: "Баруун кэмп", offset: 35, campId: "camp_ot_west" },
        { name: "Ханбогд", offset: 90 },
        { name: "Гашуун сухайт кэмп", offset: 180, siteId: "site_ot_gs", campId: "camp_gs" },
      ],
    },
    {
      code: "OT-SHIFT",
      name: "Кэмп — уурхайн ээлжийн тээвэр",
      origin: "Гол кэмп",
      destination: "Уурхай",
      durationMinutes: 45,
      stops: [
        { name: "Гол кэмп", offset: 0, campId: "camp_ot_main" },
        { name: "Баруун кэмп", offset: 15, campId: "camp_ot_west" },
        { name: "Уурхайн талбай", offset: 45, siteId: "site_ot_mine" },
      ],
    },
  ];

  for (const route of ROUTES) {
    const routeId = `tr_${ORG_A}_${route.code}`;
    db.transportRoutes.push({
      id: routeId,
      organizationId: ORG_A,
      code: route.code,
      name: route.name,
      origin: route.origin,
      destination: route.destination,
      durationMinutes: route.durationMinutes,
      status: "active",
    });
    route.stops.forEach((stop, i) => {
      db.transportStops.push({
        id: `ts_${routeId}_${i}`,
        organizationId: ORG_A,
        routeId,
        name: stop.name,
        sequenceNumber: i,
        scheduledOffsetMinutes: stop.offset,
        siteId: stop.siteId ?? null,
        campId: stop.campId ?? null,
      });
    });
  }

  /* Mixed fleet: owned coaches plus a contractor's vehicles, because the
     brief is explicit that both exist and that a contractor's driver is not
     our employee. */
  const FLEET: [string, Vehicle["vehicleType"], number, Vehicle["ownership"], string | null][] = [
    ["УБА-1201", "bus", 45, "owned", null],
    ["УБА-1202", "bus", 45, "owned", null],
    ["УБА-1203", "bus", 45, "owned", null],
    ["УБА-1180", "bus", 50, "owned", null],
    ["ӨМГ-2204", "coaster", 22, "owned", null],
    ["ӨМГ-2205", "coaster", 22, "owned", null],
    ["ТӨВ-3310", "bus", 45, "contracted", "Монгол Экспресс Тээвэр"],
    ["ТӨВ-3311", "bus", 45, "contracted", "Монгол Экспресс Тээвэр"],
    ["ТӨВ-4420", "coaster", 19, "contracted", "Говь Транс"],
    ["УБА-5501", "van", 11, "owned", null],
  ];
  FLEET.forEach(([registrationNumber, vehicleType, seatingCapacity, ownership, providerName], i) => {
    db.vehicles.push({
      id: `veh_${ORG_A}_${i}`,
      organizationId: ORG_A,
      registrationNumber,
      vehicleType,
      seatingCapacity,
      ownership,
      providerName,
      // One vehicle off the road, so "available fleet" is never the whole fleet.
      status: i === 3 ? "maintenance" : "active",
      note: i === 3 ? "Төлөвлөгөөт засвар" : null,
    });
  });

  const driverEmployees = db.employees.filter(
    (e) => e.organizationId === ORG_A && e.jobTitle.includes("жолооч") && e.status === "active",
  );
  for (let i = 0; i < 12; i++) {
    const contracted = i >= 8;
    const employee = !contracted ? driverEmployees[i % Math.max(1, driverEmployees.length)] : undefined;
    db.drivers.push({
      id: `drv_${ORG_A}_${i}`,
      organizationId: ORG_A,
      // A contractor's driver has no employee record with us, and pretending
      // otherwise is the modelling error the brief warns about.
      employeeId: contracted ? null : (employee?.id ?? null),
      fullName:
        employee?.displayName ??
        `${rng.pick(SURNAMES).charAt(0)}.${rng.pick(GIVEN_NAMES_M)}`,
      phone: `+976 ${rng.int(8800, 9999)} ${rng.int(1000, 9999)}`,
      licenceNumber: `D${rng.int(100000, 999999)}`,
      // A couple of licences expiring soon, so the compliance view has teeth.
      licenceExpiresAt: d(addDays(today, i < 2 ? rng.int(5, 40) : rng.int(200, 1200))),
      providerName: contracted ? (i === 11 ? "Говь Транс" : "Монгол Экспресс Тээвэр") : null,
      status: "active",
    });
  }

  /* Trips: a fortnight either side of today. */
  const activeVehicles = db.vehicles.filter((v) => v.status === "active");
  const activeDrivers = db.drivers.filter((dr) => dr.status === "active");
  const stopsByRoute = new Map<string, TransportStop[]>();
  for (const stop of db.transportStops) {
    const list = stopsByRoute.get(stop.routeId) ?? [];
    list.push(stop);
    stopsByRoute.set(stop.routeId, list);
  }
  for (const list of stopsByRoute.values()) list.sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  const DEPARTURE_HOURS: Record<string, number[]> = {
    "UB-OT": [7],
    "OT-UB": [7],
    "OT-GS": [9, 15],
    "OT-SHIFT": [6, 18],
  };

  let tripSeq = 0;
  for (let dayOffset = -14; dayOffset <= 14; dayOffset++) {
    const day = addDays(today, dayOffset);
    for (const route of db.transportRoutes) {
      for (const hour of DEPARTURE_HOURS[route.code] ?? [8]) {
        // The long-haul routes do not run every day.
        if ((route.code === "UB-OT" || route.code === "OT-UB") && (dayOffset + 14) % 2 === 1) continue;

        const departure = new Date(startOfDay(day).getTime() + hour * 3_600_000);
        const past = departure.getTime() < today.getTime();
        const vehicle = activeVehicles[tripSeq % activeVehicles.length];
        const driver = activeDrivers[tripSeq % activeDrivers.length];

        const cancelled = !past && rng.bool(0.04);
        const delayed = past && rng.bool(0.1);
        const status: TransportTrip["status"] = cancelled
          ? "cancelled"
          : past
            ? "arrived"
            : dayOffset === 0 && hour <= 8
              ? "boarding"
              : "scheduled";

        const delayMinutes = delayed ? rng.int(25, 180) : 0;
        const estimatedArrival = new Date(
          departure.getTime() + route.durationMinutes * 60_000,
        );

        db.transportTrips.push({
          id: `tt_${ORG_A}_${tripSeq}`,
          organizationId: ORG_A,
          routeId: route.id,
          vehicleId: cancelled ? null : vehicle.id,
          driverId: cancelled ? null : driver.id,
          departureAt: departure.toISOString(),
          estimatedArrivalAt: estimatedArrival.toISOString(),
          actualDepartureAt: past && !cancelled ? new Date(departure.getTime() + rng.int(-5, 20) * 60_000).toISOString() : null,
          actualArrivalAt:
            past && !cancelled
              ? new Date(estimatedArrival.getTime() + delayMinutes * 60_000).toISOString()
              : null,
          status,
          statusReason: cancelled
            ? rng.pick(["Цасан шуурга", "Техникийн гэмтэл", "Зорчигч хүрэлцээгүй"])
            : null,
          note: null,
        });

        if (delayed) {
          db.transportIncidents.push({
            id: `ti_${ORG_A}_${tripSeq}`,
            organizationId: ORG_A,
            tripId: `tt_${ORG_A}_${tripSeq}`,
            incidentType: rng.pick(["delay", "breakdown", "road_closure", "weather"] as const),
            description: rng.pick([
              "Замын засварын улмаас саатсан.",
              "Дугуй солих шаардлага гарсан.",
              "Цасан шуурганы улмаас хурд сааруулсан.",
            ]),
            occurredAt: departure.toISOString(),
            delayMinutes,
            status: "resolved",
            reportedBy: "user_transport",
          });
        }

        tripSeq++;
      }
    }
  }

  /* Bookings and passengers, driven by the roster's own travel days so the
     transport plan and the roster describe the same mobilisation. */
  const travelAssignments = db.rosterAssignments.filter(
    (a) => a.dayType === "travel_in" || a.dayType === "travel_out",
  );
  const tripsByRouteDate = new Map<string, TransportTrip[]>();
  for (const trip of db.transportTrips) {
    const key = `${trip.routeId}|${d(new Date(trip.departureAt))}`;
    const list = tripsByRouteDate.get(key) ?? [];
    list.push(trip);
    tripsByRouteDate.set(key, list);
  }

  const inboundRoute = db.transportRoutes.find((r) => r.code === "UB-OT")!;
  const outboundRoute = db.transportRoutes.find((r) => r.code === "OT-UB")!;

  let transportBookingSeq = 0;
  let passengerSeq = 0;
  const seatUsage = new Map<string, number>();

  for (const assignment of travelAssignments) {
    const inbound = assignment.dayType === "travel_in";
    const route = inbound ? inboundRoute : outboundRoute;
    const candidates = tripsByRouteDate.get(`${route.id}|${assignment.date}`) ?? [];
    const trip = candidates.find((t) => t.status !== "cancelled");
    if (!trip) continue;

    const vehicle = db.vehicles.find((v) => v.id === trip.vehicleId);
    if (!vehicle) continue;
    const used = seatUsage.get(trip.id) ?? 0;
    if (used >= vehicle.seatingCapacity) continue; // the seed never oversells
    seatUsage.set(trip.id, used + 1);

    const stops = stopsByRoute.get(route.id)!;
    // Most people ride the whole route; a minority join or leave part-way,
    // which is what makes the per-leg view meaningful.
    const partial = rng.bool(0.25);
    const boardingSeq = partial && !inbound ? rng.int(0, 1) : 0;
    const destinationSeq = partial && inbound ? rng.int(2, stops.length - 1) : stops.length - 1;

    const bookingId = `tb_${ORG_A}_${transportBookingSeq++}`;
    db.transportBookings.push({
      id: bookingId,
      organizationId: ORG_A,
      bookingReference: `TB-${String(100000 + transportBookingSeq)}`,
      requestedBy: "user_transport",
      requestedAt: subDays(new Date(trip.departureAt), rng.int(2, 14)).toISOString(),
      status: trip.status === "arrived" ? "completed" : "confirmed",
      purpose: inbound ? "Ээлжинд ирэх" : "Ээлжээс буцах",
      note: null,
      idempotencyKey: null,
    });

    const past = trip.status === "arrived";
    // Booked is not boarded: a slice of past passengers never turned up.
    const outcome = past
      ? rng.weighted([["boarded", 93], ["no_show", 7]] as const)
      : "booked";

    const passengerId = `tp_${ORG_A}_${passengerSeq++}`;
    db.transportPassengers.push({
      id: passengerId,
      organizationId: ORG_A,
      bookingId,
      tripId: trip.id,
      employeeId: assignment.employeeId,
      visitorId: null,
      boardingStopId: stops[boardingSeq].id,
      destinationStopId: stops[destinationSeq].id,
      status: outcome === "boarded" ? "arrived" : outcome === "no_show" ? "no_show" : "booked",
      seatNumber: null,
    });

    if (past) {
      db.boardingRecords.push({
        id: `br_${ORG_A}_${passengerSeq}`,
        organizationId: ORG_A,
        passengerId,
        tripId: trip.id,
        eventType: outcome === "boarded" ? "boarded" : "no_show",
        occurredAt: trip.actualDepartureAt ?? trip.departureAt,
        stopId: stops[boardingSeq].id,
        recordedBy: "user_boarding",
        scannedCode: outcome === "boarded" && rng.bool(0.6) ? `QR-${passengerId}` : null,
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
