import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ordersRouter from "./orders";
import authRouter from "./auth";
import pecasRouter from "./pecas";
import garantiasPecaRouter from "./garantias-peca";
import vendasRouter from "./vendas";
import contasReceberRouter from "./contas-receber";
import caixaRouter from "./caixa";
import caixaSessoesRouter from "./caixa-sessoes";
import financeiroRouter from "./financeiro";
import pushRouter from "./push";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ordersRouter);
router.use(authRouter);
router.use(pecasRouter);
router.use(garantiasPecaRouter);
router.use(vendasRouter);
router.use(contasReceberRouter);
router.use(caixaRouter);
router.use(caixaSessoesRouter);
router.use(financeiroRouter);
router.use(pushRouter);

export default router;
