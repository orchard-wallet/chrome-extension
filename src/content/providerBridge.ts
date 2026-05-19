const script = document.createElement("script");
script.src = chrome.runtime?.getURL?.("assets/inpage.js") ?? "";
script.type = "text/javascript";
script.onload = () => script.remove();
(document.documentElement || document.head).appendChild(script);

window.addEventListener("my-passkey-wallet:request", (event) => {
  const detail = (event as CustomEvent).detail as {
    id: string;
    method: string;
    params?: unknown[];
  };

  chrome.runtime?.sendMessage?.(
    {
      type: "dapp_request",
      id: detail.id,
      method: detail.method,
      params: detail.params ?? [],
      origin: window.location.origin
    },
    (response) => {
      window.dispatchEvent(
        new CustomEvent("my-passkey-wallet:response", {
          detail: {
            id: detail.id,
            response
          }
        })
      );
    }
  );
});
