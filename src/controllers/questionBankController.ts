import type { Request, Response } from "express";
import * as questionBankService from "../services/questionBankService";

export async function list(_req: Request, res: Response) {
  res.json(await questionBankService.list());
}
