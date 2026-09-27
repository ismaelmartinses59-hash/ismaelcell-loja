import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ordersRouter from "./orders";
import authRouter from "./auth";
import { requireFinanceSession } from "./auth";
import publicStatusRouter from "./public-status";
import pecasRouter from "./pecas";
import garantiasPecaRouter from "./garantias-peca";
import vendasRouter from "./vendas";
import contasReceberRouter from "./contas-receber";
import caixaRouter from "./caixa";
import caixaSessoesRouter from "./caixa-sessoes";
import financeiroRouter from "./financeiro";
import financeiroIaRouter from "./financeiro-ia";
import pushRouter from "./push";
import encomendasRouter from "./encomendas";
import esperaRouter from "./espera";
import devolucoesRouter from "./devolucoes";
import pedidosRouter from "./pedidos";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(publicStatusRouter);
// Every business route, including reads and inventory-changing operations,
// requires the same server-issued session as the finance assistant.
router.use(requireFinanceSession);
router.use(ordersRouter);
router.use(pecasRouter);
router.use(garantiasPecaRouter);
router.use(vendasRouter);
router.use(contasReceberRouter);
router.use(caixaRouter);
router.use(caixaSessoesRouter);
router.use(financeiroRouter);
router.use(financeiroIaRouter);
router.use(pushRouter);
router.use(encomendasRouter);
router.use(esperaRouter);
router.use(devolucoesRouter);
router.use(pedidosRouter);

export default router;
