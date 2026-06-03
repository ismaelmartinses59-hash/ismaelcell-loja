import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ordersRouter from "./orders";
import authRouter from "./auth";
import pecasRouter from "./pecas";
import garantiasPecaRouter from "./garantias-peca";
import vendasRouter from "./vendas";
import contasReceberRouter from "./contas-receber";
import caixaRouter from "./caixa";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ordersRouter);
router.use(authRouter);
router.use(pecasRouter);
router.use(garantiasPecaRouter);
router.use(vendasRouter);
router.use(contasReceberRouter);
router.use(caixaRouter);

export default router;
