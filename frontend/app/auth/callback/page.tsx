"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { setToken } from "../../../lib/api";

function AuthCallbackContent() {
  const params = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const token = params.get("token");
    if (token) {
      setToken(token);
      router.replace("/dashboard");
      return;
    }
    router.replace("/dashboard?auth=failed");
  }, [params, router]);

  return <p className="muted">登录处理中...</p>;
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<p className="muted">登录处理中...</p>}>
      <AuthCallbackContent />
    </Suspense>
  );
}
