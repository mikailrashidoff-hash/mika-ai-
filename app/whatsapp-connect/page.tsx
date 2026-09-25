"use client";

import { useEffect, useState } from "react";

declare global {
  interface Window {
    FB: any;
    fbAsyncInit: () => void;
  }
}

const APP_ID = "1325627329447199";
const CONFIG_ID = "2162837427989005";

export default function WhatsAppConnectPage() {
  const [sdkReady, setSdkReady] = useState(false);
  const [status, setStatus] = useState(
    "Готовим подключение WhatsApp..."
  );

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (
        event.origin !== "https://www.facebook.com" &&
        event.origin !== "https://web.facebook.com"
      ) {
        return;
      }

      let data = event.data;

      try {
        if (typeof data === "string") {
          data = JSON.parse(data);
        }
      } catch {
        return;
      }

      if (data?.type !== "WA_EMBEDDED_SIGNUP") {
        return;
      }

      console.log("WA_EMBEDDED_SIGNUP:", data);

      if (
        data?.event === "FINISH" ||
        data?.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
      ) {
        const wabaId = data?.data?.waba_id;
        const phoneNumberId = data?.data?.phone_number_id;

        setStatus(
          `WhatsApp подключён. WABA ID: ${
            wabaId || "получен"
          }, Phone Number ID: ${
            phoneNumberId || "получен"
          }`
        );

        console.log("WABA ID:", wabaId);
        console.log("Phone Number ID:", phoneNumberId);
      }

      if (data?.event === "CANCEL") {
        setStatus("Подключение отменено.");
      }

      if (data?.event === "ERROR") {
        setStatus(
          "Meta вернула ошибку подключения. Откройте консоль для деталей."
        );
        console.error("Embedded Signup error:", data);
      }
    }

    window.addEventListener("message", handleMessage);

    window.fbAsyncInit = function () {
      window.FB.init({
        appId: APP_ID,
        cookie: true,
        xfbml: true,
        version: "v25.0",
      });

      setSdkReady(true);
      setStatus("Готово. Можно подключать WhatsApp.");
    };

    if (!document.getElementById("facebook-jssdk")) {
      const script = document.createElement("script");

      script.id = "facebook-jssdk";
      script.src =
        "https://connect.facebook.net/en_US/sdk.js";
      script.async = true;
      script.defer = true;

      document.body.appendChild(script);
    } else if (window.FB) {
      setSdkReady(true);
      setStatus("Готово. Можно подключать WhatsApp.");
    }

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  function connectWhatsApp() {
    if (!window.FB || !sdkReady) {
      setStatus(
        "Facebook SDK ещё загружается. Подождите несколько секунд."
      );
      return;
    }

    setStatus("Открываем подключение WhatsApp...");

    window.FB.login(
      (response: any) => {
        console.log("Facebook Login response:", response);

        if (response?.authResponse?.code) {
          const code = response.authResponse.code;

          sessionStorage.setItem(
            "whatsapp_signup_code",
            code
          );

          setStatus(
            "Авторизация Meta выполнена. Завершите подключение WhatsApp в открывшемся окне."
          );

          console.log(
            "Embedded Signup authorization code received."
          );
        } else {
          setStatus(
            "Авторизация не завершена. Попробуйте ещё раз."
          );
        }
      },
      {
        config_id: CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,

        extras: {
          setup: {},
          featureType:
            "whatsapp_business_app_onboarding",
          sessionInfoVersion: "3",
        },
      }
    );
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f5f7fb",
        padding: "24px",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: "600px",
          margin: "60px auto",
          background: "white",
          borderRadius: "24px",
          padding: "30px",
          boxShadow:
            "0 18px 50px rgba(0,0,0,0.08)",
        }}
      >
        <h1 style={{ marginTop: 0 }}>
          Подключение WhatsApp
        </h1>

        <p
          style={{
            color: "#666",
            lineHeight: 1.5,
          }}
        >
          Подключите существующий WhatsApp Business к
          Mika AI.
        </p>

        <button
          onClick={connectWhatsApp}
          disabled={!sdkReady}
          style={{
            width: "100%",
            border: "none",
            borderRadius: "14px",
            padding: "16px 20px",
            fontSize: "17px",
            fontWeight: 700,
            background: sdkReady
              ? "#25D366"
              : "#aaa",
            color: "white",
            cursor: sdkReady
              ? "pointer"
              : "default",
          }}
        >
          Подключить WhatsApp
        </button>

        <div
          style={{
            marginTop: "20px",
            padding: "14px",
            borderRadius: "12px",
            background: "#f2f4f7",
            lineHeight: 1.5,
          }}
        >
          {status}
        </div>
      </div>
    </main>
  );
}
