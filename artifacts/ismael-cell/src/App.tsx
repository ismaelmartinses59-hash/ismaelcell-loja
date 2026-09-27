import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import {
  QueryClient,
  QueryClientProvider,
  QueryCache,
  MutationCache,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import NotFound from "@/pages/not-found";

import Login from "@/pages/login";
import Orders from "@/pages/orders";
import Status from "@/pages/status";
import { fetchWithSession, notifySessionExpired, SESSION_EXPIRED_EVENT } from "@/lib/api-fetch";

function isUnauthorized(error: unknown): boolean {
  return !!error && typeof error === "object" && "status" in error &&
    (error as { status?: unknown }).status === 401;
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (isUnauthorized(error)) notifySessionExpired();
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      if (isUnauthorized(error)) notifySessionExpired();
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
});

function AuthenticatedOrders() {
  const [, setLocation] = useLocation();
  const client = useQueryClient();
  const session = useQuery({
    queryKey: ["auth-session"],
    queryFn: async () => {
      const response = await fetchWithSession(
        `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/auth/session`,
        { cache: "no-store" },
        false,
      );
      if (response.status === 401) return { authenticated: false };
      if (!response.ok) throw new Error("Não foi possível validar sua sessão.");
      const result = await response.json();
      return { authenticated: result?.authenticated === true };
    },
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });

  useEffect(() => {
    if (session.data?.authenticated === false) {
      client.clear();
      localStorage.removeItem("isLoggedIn");
      localStorage.removeItem("userEmail");
      setLocation("/");
    }
  }, [client, session.data, setLocation]);

  if (session.data?.authenticated === true) return <Orders />;

  if (session.isError) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p role="alert" className="text-sm text-muted-foreground">
          {session.error instanceof Error ? session.error.message : "Não foi possível validar sua sessão."}
        </p>
        <Button onClick={() => void session.refetch()}>Tentar novamente</Button>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6" aria-live="polite">
      <p className="text-sm text-muted-foreground">Verificando sessão...</p>
    </main>
  );
}

function SessionExpiryRedirect() {
  const [, setLocation] = useLocation();
  const client = useQueryClient();

  useEffect(() => {
    const handleExpiredSession = () => {
      client.clear();
      localStorage.removeItem("isLoggedIn");
      localStorage.removeItem("userEmail");
      setLocation("/");
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, handleExpiredSession);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleExpiredSession);
  }, [client, setLocation]);

  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Login} />
      <Route path="/ordens" component={AuthenticatedOrders} />
      <Route path="/status/:codigo" component={Status} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <SessionExpiryRedirect />
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
