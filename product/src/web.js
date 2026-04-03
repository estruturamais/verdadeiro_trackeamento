(function() {
  'use strict';

  /*__CONFIG__*/
  /*__MARCA_USER__*/

  var __CONFIG__ = (typeof __CONFIG__ !== 'undefined') ? __CONFIG__ : {};
  var __PURCHASE_EVENT_ID__ = '';

  // ============================================================
  // MODULE 1 — Identification (SPEC 2.1)
  // ============================================================

  function generateEventId() {
    var timestamp = Date.now();
    var uuid;
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      uuid = crypto.randomUUID();
    } else {
      uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0;
        var v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }
    return timestamp + '-' + uuid;
  }

  function getOrCreateMarcaUser() {
    var cookieMatch = document.cookie.match(/marca_user=([^;]+)/);
    if (cookieMatch && cookieMatch[1]) return cookieMatch[1];

    var localVal = localStorage.getItem('marca_user');
    if (localVal) return localVal;

    var sessionVal = sessionStorage.getItem('marca_user');
    if (sessionVal) return sessionVal;

    var newId = generateEventId();

    try { localStorage.setItem('marca_user', newId); } catch(e) {}
    try { sessionStorage.setItem('marca_user', newId); } catch(e) {}
    try {
      var rd = (function() {
        var p = window.location.hostname.split('.');
        return p.length >= 2 ? '.' + p.slice(-2).join('.') : window.location.hostname;
      })();
      document.cookie = 'marca_user=' + newId + ';path=/;max-age=63072000;SameSite=Lax;domain=' + rd;
    } catch(e) {}

    return newId;
  }

  try {
    var __MARCA_USER__ = (typeof __MARCA_USER__ !== 'undefined' && __MARCA_USER__)
      ? __MARCA_USER__
      : getOrCreateMarcaUser();
  } catch(e) {
    var __MARCA_USER__ = getOrCreateMarcaUser();
  }

  // Persist marca_user in localStorage/sessionStorage so getAamaisId() can read it
  // (the Worker sets HttpOnly cookie which JS cannot read)
  try { localStorage.setItem('marca_user', __MARCA_USER__); } catch(e) {}
  try { sessionStorage.setItem('marca_user', __MARCA_USER__); } catch(e) {}
  try {
    var rootDomain = (function() {
      var parts = window.location.hostname.split('.');
      return parts.length >= 2 ? '.' + parts.slice(-2).join('.') : window.location.hostname;
    })();
    document.cookie = 'marca_user=' + __MARCA_USER__ + ';path=/;max-age=63072000;SameSite=Lax;domain=' + rootDomain;
  } catch(e) {}

  // ============================================================
  // MODULE 2 — Transfer (SPEC 2.2)
  // ============================================================

  var GATEWAYS = (__CONFIG__ && __CONFIG__.gateways_config) ? __CONFIG__.gateways_config : {
    hotmart: {
      domains: ['hotmart.com', 'hotmart.com.br', 'pay.hotmart.com', 'go.hotmart.com'],
      caminho: 'sck',
      indexador: 'xcod',
      user_params: { email: 'email', phone: 'phonenumber', name: 'name' }
    },
    kiwify: {
      domains: ['kiwify.com', 'kiwify.com.br', 'pay.kiwify.com.br'],
      caminho: 'caminho',
      indexador: 'sck'
    },
    ticto: {
      domains: ['ticto.com.br', 'ticto.app', 'checkout.ticto.app', 'checkout.ticto.com.br'],
      caminho: 'caminho',
      indexador: 'sck'
    },
    kirvano: {
      domains: ['kirvano.com', 'pay.kirvano.com'],
      caminho: 'caminho',
      indexador: 'src'
    },
    eduzz: {
      domains: ['eduzz.com', 'eduzz.com.br', 'chk.eduzz.com', 'sun.eduzz.com'],
      caminho: 'caminho',
      indexador: 'utm_medium'
    },
    lastlink: {
      domains: ['lastlink.com', 'lastlink.com.br', 'pay.lastlink.com'],
      caminho: 'caminho',
      indexador: 'utm_id'
    },
    perfectpay: {
      domains: ['perfectpay.com.br', 'checkout.perfectpay.com.br'],
      caminho: 'caminho',
      indexador: 'utm_perfect'
    },
    pagtrust: {
      domains: ['pagtrust.com', 'pagtrust.com.br', 'checkout.pagtrust.com.br'],
      caminho: 'sck',
      indexador: 'sck'
    },
    payt: {
      domains: ['payt.com.br', 'checkout.payt.com.br'],
      caminho: 'caminho',
      indexador: 'src'
    }
  };

  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([\.$?*|{}\(\)\[\]\\\/\+^])/g, '\\$1') + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : undefined;
  }

  function getUtmData() {
    var parametros = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id'];
    var url = new URL(window.location.href);
    var params = url.searchParams;
    var referrer = document.referrer;
    var utms = {};

    params.forEach(function(value, key) {
      if (parametros.indexOf(key) === -1) {
        parametros.push(key);
      }
      utms[key] = value;
    });

    if (referrer) {
      try {
        var referrerUrl = new URL(referrer);
        if (referrerUrl.hostname !== window.location.hostname) {
          if (utms['utm_source'] === undefined) {
            utms['utm_source'] = referrerUrl.hostname;
            utms['utm_medium'] = 'referral';
          }
        } else {
          if (utms['utm_source'] === undefined) {
            utms['utm_source'] = 'direct';
          }
        }
      } catch(e) {
        if (utms['utm_source'] === undefined) {
          utms['utm_source'] = 'direct';
        }
      }
    } else {
      if (utms['utm_source'] === undefined) {
        utms['utm_source'] = 'direct';
      }
    }

    parametros.forEach(function(el) {
      if (utms[el] === undefined) {
        utms[el] = '';
      }
    });

    return utms;
  }

  function buildSckString(utms) {
    var sckOrder = [
      utms['utm_source'] || '',
      utms['utm_medium'] || '',
      utms['utm_campaign'] || '',
      utms['utm_term'] || '',
      utms['utm_content'] || '',
      utms['utm_id'] || ''
    ];
    return sckOrder.join('|');
  }

  function getAamaisId() {
    var cookieMatch = document.cookie.match(/marca_user=([^;]+)/);
    if (cookieMatch && cookieMatch[1]) return cookieMatch[1];
    var localVal = localStorage.getItem('marca_user');
    if (localVal) return localVal;
    return sessionStorage.getItem('marca_user') || '';
  }

  function detectGateway(targetUrl) {
    try {
      var urlObj = new URL(targetUrl, window.location.origin);
      var hostname = urlObj.hostname.toLowerCase();

      for (var gatewayName in GATEWAYS) {
        if (!GATEWAYS.hasOwnProperty(gatewayName)) continue;
        var gateway = GATEWAYS[gatewayName];

        for (var i = 0; i < gateway.domains.length; i++) {
          var domain = gateway.domains[i].toLowerCase();
          if (hostname === domain || hostname.indexOf('.' + domain) !== -1 ||
              hostname.indexOf(domain) === hostname.length - domain.length) {
            return {
              name: gatewayName,
              caminho: gateway.caminho,
              indexador: gateway.indexador
            };
          }
        }
      }
    } catch(e) {}
    return null;
  }

  function addParamsToUrl(url) {
    var newUrl;
    try {
      newUrl = new URL(url, window.location.origin);
    } catch(e) {
      return url;
    }

    var existingParams = new URLSearchParams(newUrl.search);
    var utms = getUtmData();
    var isExternal = newUrl.hostname !== window.location.hostname;

    // User data from cookies (inline — avoids naming conflict with Module 4 getUserData)
    var email = getCookie('marca_email') || '';
    var phone = getCookie('marca_phone') || '';
    var name = getCookie('marca_name') || '';
    var userId = getAamaisId();

    Object.keys(utms).forEach(function(key) {
      if (utms[key]) {
        existingParams.set(key, utms[key]);
      }
    });

    if (isExternal) {
      var gateway = detectGateway(newUrl.href);

      // user_params: usa mapeamento do gateway se existir, senao default (padrao Hotmart)
      var defaultUserParams = { email: 'email', phone: 'phonenumber', name: 'name' };
      var userParams = (gateway && gateway.user_params) ? gateway.user_params : defaultUserParams;

      if (email) existingParams.set(userParams.email, email);
      if (phone) existingParams.set(userParams.phone, phone.length > 2 ? phone.substring(2) : phone);
      if (name) existingParams.set(userParams.name, name);

      if (gateway) {
        var sckString = buildSckString(utms);
        existingParams.set(gateway.caminho, sckString);
        if (userId) {
          existingParams.set(gateway.indexador, userId);
        }
        if (__CONFIG__.debug || getUrlParam('debug') === '1') {
          console.log('[Tracking] Gateway detected: ' + gateway.name + ' | ' + gateway.caminho + '=' + sckString + ' | ' + gateway.indexador + '=' + userId);
        }
      } else {
        var sckStringFallback = buildSckString(utms);
        existingParams.set('caminho', sckStringFallback);
        if (userId) {
          existingParams.set('indexador', userId);
        }
      }
    }

    newUrl.search = existingParams.toString();
    return newUrl.toString();
  }

  function handleLinkClicks(e) {
    var target = e.target.closest('a');
    if (!target) return;

    var href = target.href;
    if (!href) return;

    if (href.indexOf('javascript:') === 0 || href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0) return;

    try {
      var targetUrl = new URL(href, window.location.origin);
      var currentUrl = new URL(window.location.href);

      if (targetUrl.origin === currentUrl.origin &&
          targetUrl.pathname === currentUrl.pathname &&
          targetUrl.hash && targetUrl.hash.length > 1 &&
          targetUrl.search === currentUrl.search) {
        return;
      }
    } catch(err) {
      return;
    }

    // Fire trigger events based on config
    var matchedTrigger = null;
    try {
      var triggers = __CONFIG__.triggers || {};
      for (var triggerName in triggers) {
        if (!triggers.hasOwnProperty(triggerName)) continue;
        var trigger = triggers[triggerName];
        if (trigger.type !== 'link_click' || !trigger.match) continue;
        var patterns = trigger.match.split('|');
        for (var p = 0; p < patterns.length; p++) {
          if (href.indexOf(patterns[p]) !== -1) {
            matchedTrigger = triggerName;
            if (__CONFIG__.debug || getUrlParam('debug') === '1') {
              console.log('[Tracking] Link click \u2192 ' + triggerName + ': ' + href);
            }
            fireTrigger(triggerName, {});
            break;
          }
        }
        if (matchedTrigger) break;
      }
    } catch(err) {
      if (__CONFIG__.debug) console.error('[Tracking] Link click trigger error:', err);
    }

    var newUrl = addParamsToUrl(href);
    if (newUrl !== href) {
      target.href = newUrl;
    }

    // Wait for Tags: delay navigation to let beacon and pixels fire
    if (matchedTrigger && target.getAttribute('target') !== '_blank') {
      e.preventDefault();
      setTimeout(function() {
        window.location.href = newUrl || href;
      }, 500);
    }
  }

  function processLink(link) {
    var href = link.getAttribute('href');
    if (!href) return;
    if (href.indexOf('javascript:') === 0 || href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0) return;
    if (href.indexOf('#') === 0) return;

    var newUrl = addParamsToUrl(href);
    if (newUrl !== href) {
      link.setAttribute('href', newUrl);
    }
  }

  function processAllLinks(root) {
    var links = (root || document).querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      processLink(links[i]);
    }
  }

  function observeDynamicElements() {
    if (typeof MutationObserver === 'undefined') return;

    var observer = new MutationObserver(function(mutationsList) {
      for (var m = 0; m < mutationsList.length; m++) {
        var mutation = mutationsList[m];
        if (mutation.type === 'childList') {
          for (var n = 0; n < mutation.addedNodes.length; n++) {
            var node = mutation.addedNodes[n];
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.tagName === 'A' && node.hasAttribute('href')) {
                processLink(node);
              }
              if (node.querySelectorAll) {
                var innerLinks = node.querySelectorAll('a[href]');
                for (var l = 0; l < innerLinks.length; l++) {
                  processLink(innerLinks[l]);
                }
              }
            }
          }
        } else if (mutation.type === 'attributes' && mutation.target.tagName === 'A') {
          processLink(mutation.target);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href']
    });
  }

  function initTransfer() {
    isInternalReplace = true;
    try { history.replaceState(null, '', addParamsToUrl(window.location.href)); } catch(e) {}
    isInternalReplace = false;

    processAllLinks();

    document.addEventListener('click', handleLinkClicks, true);

    observeDynamicElements();

    window.addEventListener('popstate', function() {
      isInternalReplace = true;
      try { history.replaceState(null, '', addParamsToUrl(window.location.href)); } catch(e) {}
      isInternalReplace = false;
    });
  }

  try {
    // SPA overrides — active immediately
    var originalPushState = history.pushState;
    history.pushState = function(state, title, url) {
      var processedUrl = url ? addParamsToUrl(url) : url;
      return originalPushState.call(history, state, title, processedUrl);
    };

    var originalReplaceState = history.replaceState;
    var isInternalReplace = false;
    history.replaceState = function(state, title, url) {
      if (isInternalReplace) return originalReplaceState.call(history, state, title, url);
      var processedUrl = url ? addParamsToUrl(url) : url;
      return originalReplaceState.call(history, state, title, processedUrl);
    };

    var originalWindowOpen = window.open;
    window.open = function(url, target, features) {
      if (url && typeof url === 'string') {
        try { url = addParamsToUrl(url); } catch(e) {}
      }
      return originalWindowOpen.call(this, url, target, features);
    };

    var origHrefDescriptor = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
    if (origHrefDescriptor && origHrefDescriptor.set) {
      Object.defineProperty(Location.prototype, 'href', {
        get: origHrefDescriptor.get,
        set: function(url) {
          try { url = addParamsToUrl(url); } catch(e) {}
          origHrefDescriptor.set.call(this, url);
        },
        configurable: true,
        enumerable: true
      });
    }

    var origAssign = Location.prototype.assign;
    Location.prototype.assign = function(url) {
      try { url = addParamsToUrl(url); } catch(e) {}
      return origAssign.call(this, url);
    };

    var origLocationReplace = Location.prototype.replace;
    Location.prototype.replace = function(url) {
      try { url = addParamsToUrl(url); } catch(e) {}
      return origLocationReplace.call(this, url);
    };

    // initTransfer on DOM Ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initTransfer);
    } else {
      setTimeout(initTransfer, 500);
    }
  } catch(e) {}

  // ============================================================
  // MODULE 3 — Pixels (SPEC 2.3)
  // ============================================================

  function normalizePhone(phone) {
    if (!phone) return '';
    phone = phone.replace(/\D/g, '');
    if (phone.length === 10 || phone.length === 11) {
      phone = '55' + phone;
    }
    return phone;
  }

  function getUserDataFromCookies() {
    var email = getCookie('marca_email') || '';
    var phone = getCookie('marca_phone') || '';
    var name = getCookie('marca_name') || '';

    var first_name = '';
    var last_name = '';
    if (name) {
      var matchFirst = name.match(/^\s*(.+?)\s+\S+\s*$/);
      var matchLast = name.match(/^\s*.+?\s+(\S+)\s*$/);
      if (matchFirst) {
        first_name = matchFirst[1];
      } else {
        first_name = name.trim();
      }
      if (matchLast) {
        last_name = matchLast[1];
      }
    }

    return {
      email: email.toLowerCase().trim(),
      phone: normalizePhone(phone),
      first_name: first_name.toLowerCase().trim(),
      last_name: last_name.toLowerCase().trim(),
      city: (getCookie('marca_city') || '').toLowerCase().trim(),
      state: (getCookie('marca_state') || '').toLowerCase().trim(),
      country: (getCookie('marca_country') || '').toLowerCase().trim()
    };
  }

  function initMetaPixels() {
    if (!__CONFIG__.meta_pixel_id) return;

    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){
      n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
      if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
      n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t,s)
    }(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');

    var userData = getUserDataFromCookies();

    fbq('init', __CONFIG__.meta_pixel_id, {
      em: userData.email,
      ph: userData.phone,
      fn: userData.first_name,
      ln: userData.last_name,
      ct: userData.city,
      st: userData.state,
      country: userData.country,
      external_id: __MARCA_USER__
    });

    if (__CONFIG__.meta_pixel_id_purchase) {
      fbq('init', __CONFIG__.meta_pixel_id_purchase, {
        em: userData.email,
        ph: userData.phone,
        fn: userData.first_name,
        ln: userData.last_name,
        ct: userData.city,
        st: userData.state,
        country: userData.country,
        external_id: __MARCA_USER__
      });
    }
  }

  function initTikTokPixel() {
    if (!__CONFIG__.tiktok_pixel_id) return;

    !function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
      ttq.methods=['page','track','identify','instances','debug','on','off',
      'once','ready','alias','group','enableCookie','disableCookie','holdConsent',
      'revokeConsent','grantConsent'];
      ttq.setAndDefer=function(t,e){t[e]=function(){
        t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
      for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
      ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)
        ttq.setAndDefer(e,ttq.methods[n]);return e};
      ttq.load=function(e,n){var r='https://analytics.tiktok.com/i18n/pixel/events.js';
        var o=n&&n.partner;ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=r;
        ttq._t=ttq._t||{};ttq._t[e+o]=+new Date;ttq._o=ttq._o||{};ttq._o[e+o]=n||{};
        var a=d.createElement('script');a.type='text/javascript';a.async=!0;a.src=r+'?sdkid='+e+'&lib='+t;
        var s=d.getElementsByTagName('script')[0];s.parentNode.insertBefore(a,s)};
      ttq.load(__CONFIG__.tiktok_pixel_id);
      ttq.page();
    }(window,document,'ttq');

    var userData = getUserDataFromCookies();
    if (userData.email || userData.phone) {
      ttq.identify({
        email: userData.email,
        phone_number: userData.phone,
        external_id: __MARCA_USER__
      });
    }
  }

  function initGA4() {
    if (!__CONFIG__.ga4_measurement_id) return;

    var script = document.createElement('script');
    script.async = true;
    script.src = '/scripts/ga.js?id=' + __CONFIG__.ga4_measurement_id;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    window.gtag = gtag;
    gtag('js', new Date());
    var ga4Config = {
      send_page_view: false,
      server_container_url: (typeof window !== 'undefined' ? window.location.origin : '')
    };
    if (__CONFIG__.debug || getUrlParam('debug') === '1') {
      ga4Config.debug_mode = true;
    }
    gtag('config', __CONFIG__.ga4_measurement_id, ga4Config);
  }

  try { initMetaPixels(); if (__CONFIG__.debug) console.log('[Tracking] Meta Pixel initialized:', __CONFIG__.meta_pixel_id); } catch(e) { if (__CONFIG__.debug) console.error('[Tracking] Meta Pixel init FAILED:', e); }
  try { initTikTokPixel(); if (__CONFIG__.debug) console.log('[Tracking] TikTok Pixel initialized:', __CONFIG__.tiktok_pixel_id || 'skipped'); } catch(e) { if (__CONFIG__.debug) console.error('[Tracking] TikTok init FAILED:', e); }
  try { initGA4(); if (__CONFIG__.debug) console.log('[Tracking] GA4 initialized:', __CONFIG__.ga4_measurement_id); } catch(e) { if (__CONFIG__.debug) console.error('[Tracking] GA4 init FAILED:', e); }

  // ============================================================
  // MODULE 4 — Events (SPEC 2.4)
  // ============================================================

  var EVENT_NAMES = {
    page_view:          { meta: 'PageView',          tiktok: 'Pageview',          ga4: 'page_view',       gads: null },
    contact:            { meta: 'Contact',            tiktok: 'Contact',           ga4: 'contact',         gads: 'contact' },
    lead:               { meta: 'Lead',               tiktok: 'SubmitForm',        ga4: 'generate_lead',   gads: 'lead' },
    initiate_checkout:  { meta: 'InitiateCheckout',   tiktok: 'InitiateCheckout',  ga4: 'begin_checkout',  gads: null },
    purchase:           { meta: 'Purchase',            tiktok: 'Purchase',          ga4: 'purchase',        gads: 'purchase' }
  };

  function getUrlParam(name) {
    try {
      return new URL(window.location.href).searchParams.get(name) || '';
    } catch(e) { return ''; }
  }

  function generateFbc() {
    var fbclid = getUrlParam('fbclid');
    if (!fbclid) return '';
    return 'fb.1.' + Date.now() + '.' + fbclid;
  }

  function extractGaClientId() {
    var ga = getCookie('_ga');
    if (!ga) return '';
    var parts = ga.split('.');
    if (parts.length >= 4) return parts[2] + '.' + parts[3];
    return '';
  }

  function findGaSessionCookie() {
    var cookies = document.cookie.split(';');
    for (var i = 0; i < cookies.length; i++) {
      var c = cookies[i].trim();
      if (c.indexOf('_ga_') === 0 && c.indexOf('=') > 0) {
        return c.split('=')[1];
      }
    }
    return '';
  }

  function extractGaSessionId() {
    var cookie = findGaSessionCookie();
    if (!cookie) return '';
    var match = cookie.match(/s(\d+)j/);
    return match ? match[1] : '';
  }

  function extractGaSessionCount() {
    var cookie = findGaSessionCookie();
    if (!cookie) return '';
    var match = cookie.match(/j(\d+)t/);
    return match ? match[1] : '';
  }

  function extractGaTimestamp() {
    var cookie = findGaSessionCookie();
    if (!cookie) return '';
    var match = cookie.match(/t(\d+)/);
    if (!match) return '';
    var ts = parseInt(match[1], 10);
    return String((ts + 60) * 1000000);
  }

  function getUserData(eventData) {
    eventData = eventData || {};

    var email = eventData.email || getCookie('marca_email') || '';
    email = email.toLowerCase().trim();

    var phone = eventData.phone || getCookie('marca_phone') || '';
    phone = normalizePhone(phone);

    var fullName = eventData.name || getCookie('marca_name') || '';

    var first_name = '';
    var last_name = '';
    if (fullName) {
      var matchFirst = fullName.match(/^\s*(.+?)\s+\S+\s*$/);
      var matchLast = fullName.match(/^\s*.+?\s+(\S+)\s*$/);
      first_name = matchFirst ? matchFirst[1] : fullName.trim();
      last_name = matchLast ? matchLast[1] : '';
    }

    return {
      email: email,
      phone: phone,
      first_name: first_name.toLowerCase().trim(),
      last_name: last_name.toLowerCase().trim(),
      city: (getCookie('marca_city') || '').toLowerCase().trim(),
      state: (getCookie('marca_state') || '').toLowerCase().trim(),
      country: (getCookie('marca_country') || '').toLowerCase().trim(),
      zip: '',
      ip_address: getCookie('marca_ip_address') || '',
      gender: getCookie('marca_gender') || '',
      marca_user: __MARCA_USER__
    };
  }

  function getBrowserData() {
    return {
      fbp: getCookie('_fbp') || '',
      fbc: getCookie('_fbc') || (getUrlParam('fbclid') ? generateFbc() : ''),
      ttp: getCookie('_ttp') || '',
      ttclid: getCookie('ttclid') || getUrlParam('ttclid') || '',
      ga_client_id: extractGaClientId(),
      ga_session_id: extractGaSessionId(),
      ga_session_count: extractGaSessionCount(),
      ga_timestamp: extractGaTimestamp()
    };
  }

  function evaluateCustomData(customDataConfig) {
    var result = {};
    for (var key in customDataConfig) {
      if (!customDataConfig.hasOwnProperty(key)) continue;
      var field = customDataConfig[key];

      if (typeof field === 'string') {
        result[key] = field;
        continue;
      }

      if (field.conditions && Array.isArray(field.conditions)) {
        var matched = false;
        for (var i = 0; i < field.conditions.length; i++) {
          var cond = field.conditions[i];
          try {
            if (new Function('return ' + cond['if'])()) {
              result[key] = cond.value;
              matched = true;
              break;
            }
          } catch(e) {}
        }
        if (!matched) {
          result[key] = field.fallback || '';
        }
      }
    }
    return result;
  }

  function buildMetaEventData(userData, customData) {
    var data = {};
    if (customData.value) data.value = customData.value;
    if (customData.currency) data.currency = customData.currency;
    if (customData.content_name) data.content_name = customData.content_name;
    return data;
  }

  function buildTikTokEventData(customData) {
    var data = {};
    if (customData.value) {
      data.value = customData.value;
      data.currency = customData.currency || 'BRL';
    }
    return data;
  }


  function sendTrackingBeacon(eventName, eventId, userData, browserData, customData) {
    var payload = {
      site_id: __CONFIG__.site_id,
      event: eventName,
      event_id: eventId,
      timestamp: Date.now(),
      page_url: window.location.href,
      page_title: document.title,
      marca_user: __MARCA_USER__,

      user_data: {
        email: userData.email,
        phone: userData.phone,
        first_name: userData.first_name,
        last_name: userData.last_name,
        city: userData.city,
        state: userData.state,
        country: userData.country,
        zip: userData.zip || '',
        ip_address: userData.ip_address || '',
        gender: userData.gender || ''
      },

      browser_data: {
        fbp: browserData.fbp,
        fbc: browserData.fbc,
        ttp: browserData.ttp,
        ttclid: browserData.ttclid,
        ga_client_id: browserData.ga_client_id,
        ga_session_id: browserData.ga_session_id,
        ga_session_count: browserData.ga_session_count,
        ga_timestamp: browserData.ga_timestamp
      },

      utm_data: getUtmData(),

      custom_data: customData,

      purchase_event_id: __PURCHASE_EVENT_ID__ || ''
    };
    __PURCHASE_EVENT_ID__ = '';

    var url = __CONFIG__.collect_url || '/collect/event';
    try {
      var blob = new Blob([JSON.stringify(payload)], {type: 'application/json'});
      navigator.sendBeacon(url, blob);
    } catch(e) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify(payload));
      } catch(e2) {}
    }
  }

  function fireTrigger(eventName, eventData) {
    try {
      var event_id = generateEventId();
      var userData = getUserData(eventData);
      var browserData = getBrowserData();
      var customData = evaluateCustomData(__CONFIG__.custom_data || {});
      var names = EVENT_NAMES[eventName];
      if (!names) return;

      // 1. Meta Pixel padrao
      if (__CONFIG__.meta_pixel_id && names.meta) {
        fbq('trackSingle', __CONFIG__.meta_pixel_id, names.meta,
          buildMetaEventData(userData, customData), {eventID: event_id});
      }

      // 2. Meta Pixel de vendas (dual-pixel)
      if (__CONFIG__.meta_pixel_id_purchase) {
        if (eventName === 'page_view') {
          fbq('trackSingle', __CONFIG__.meta_pixel_id_purchase, 'PageView',
            buildMetaEventData(userData, customData), {eventID: event_id});
        }
        var purchaseTrigger = __CONFIG__.meta_purchase_trigger_event || 'lead';
        if (eventName === purchaseTrigger) {
          __PURCHASE_EVENT_ID__ = generateEventId();
          fbq('trackSingle', __CONFIG__.meta_pixel_id_purchase, 'Purchase',
            buildMetaEventData(userData, customData), {eventID: __PURCHASE_EVENT_ID__});
        }
      }

      // 3. TikTok
      if (__CONFIG__.tiktok_pixel_id && names.tiktok && typeof ttq !== 'undefined') {
        ttq.track(names.tiktok, buildTikTokEventData(customData), {event_id: event_id});
      }

      // 4. GA4 — dispatch movido para server-side (collect-event.js → sendGA4Event)
      //    initGA4() mantido para gerar cookies _ga/_ga_* usados pelo beacon

      // 5. Google Ads (web — quando channel === 'web')
      if (__CONFIG__.google_ads_conversion_id && names.gads && __CONFIG__.google_ads_channel === 'web') {
        gtag('event', 'conversion', {
          send_to: __CONFIG__.google_ads_conversion_id + '/' +
            __CONFIG__['google_ads_label_' + names.gads],
          value: customData.value || undefined,
          currency: customData.currency || 'BRL'
        });
      }

      // 6. sendBeacon ao Worker
      sendTrackingBeacon(eventName, event_id, userData, browserData, customData);

      // Debug mode
      if (__CONFIG__.debug || getUrlParam('debug') === '1') {
        console.log('[Tracking] ' + eventName + ' fired - event_id: ' + event_id);
        console.log('[Tracking]   userData:', userData);
        console.log('[Tracking]   browserData:', browserData);
        console.log('[Tracking]   customData:', customData);
      }
    } catch(e) {
      if (__CONFIG__.debug) console.error('[Tracking] Error in fireTrigger:', e);
    }
  }

  // ============================================================
  // MODULE 5 — Forms (SPEC 2.5)
  // ============================================================

  function extractGenericFormData(form) {
    var email = '';
    var phone = '';
    var name = '';
    var inputs = form.querySelectorAll('input, textarea, select');

    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      var type = (input.type || '').toLowerCase();
      var inputName = (input.name || '').toLowerCase();
      var val = (input.value || '').trim();
      if (!val) continue;

      if (!email && (type === 'email' || inputName.indexOf('email') !== -1 || inputName.indexOf('e-mail') !== -1)) {
        email = val;
      }
      if (!phone && (type === 'tel' || inputName.indexOf('phone') !== -1 || inputName.indexOf('tel') !== -1 ||
          inputName.indexOf('whatsapp') !== -1 || inputName.indexOf('celular') !== -1 || inputName.indexOf('fone') !== -1)) {
        phone = val;
      }
      if (!name && (inputName.indexOf('name') !== -1 || inputName.indexOf('nome') !== -1) &&
          inputName.indexOf('email') === -1 && type !== 'email') {
        name = val;
      }
    }

    return { email: email, phone: phone, name: name };
  }

  function extractCF7Data(inputs) {
    var email = '';
    var phone = '';
    var name = '';

    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      var inputName = (input.name || '').toLowerCase();
      var val = (input.value || '').trim();
      if (!val) continue;

      if (!email && (inputName.indexOf('email') !== -1)) email = val;
      if (!phone && (inputName.indexOf('phone') !== -1 || inputName.indexOf('tel') !== -1)) phone = val;
      if (!name && (inputName.indexOf('name') !== -1 || inputName.indexOf('nome') !== -1) && inputName.indexOf('email') === -1) name = val;
    }

    return { email: email, phone: phone, name: name };
  }

  function extractFormData(detail) {
    if (!detail) return { email: '', phone: '', name: '' };
    var form = detail.form || detail;
    if (form instanceof HTMLFormElement) return extractGenericFormData(form);
    return { email: '', phone: '', name: '' };
  }

  function saveUserCookies(formData) {
    var maxAge = 63072000; // 2 anos
    if (formData.email) {
      document.cookie = 'marca_email=' + encodeURIComponent(formData.email) + ';path=/;max-age=' + maxAge + ';SameSite=Lax';
    }
    if (formData.phone) {
      document.cookie = 'marca_phone=' + encodeURIComponent(normalizePhone(formData.phone)) + ';path=/;max-age=' + maxAge + ';SameSite=Lax';
    }
    if (formData.name) {
      document.cookie = 'marca_name=' + encodeURIComponent(formData.name) + ';path=/;max-age=' + maxAge + ';SameSite=Lax';
    }
  }

  function initForms() {
    document.addEventListener('submit_success', function(event) {
      try {
        var formData = extractFormData(event.detail);
        saveUserCookies(formData);
        fireTrigger('lead', formData);
      } catch(e) {}
    });

    document.addEventListener('wpcf7mailsent', function(event) {
      try {
        var inputs = event.detail && event.detail.inputs ? event.detail.inputs : [];
        var formData = extractCF7Data(inputs);
        saveUserCookies(formData);
        fireTrigger('lead', formData);
      } catch(e) {}
    });

    // Capture Elementor form data on submit (before AJAX clears the fields)
    var _elementorPendingFormData = null;
    document.addEventListener('submit', function(event) {
      try {
        var form = event.target;
        if (!form || form.tagName !== 'FORM') return;
        if (form.classList.contains('elementor-form')) {
          _elementorPendingFormData = extractGenericFormData(form);
          return;
        }
        if (form.classList.contains('wpcf7-form')) return;

        var formData = extractGenericFormData(form);
        saveUserCookies(formData);
        fireTrigger('lead', formData);
      } catch(e) {}
    }, true);

    // Helper to fire lead from Elementor form (deduplicates across methods)
    var _elLeadFired = false;
    function _fireElementorLead() {
      if (_elLeadFired) return;
      _elLeadFired = true;
      setTimeout(function() { _elLeadFired = false; }, 5000);
      try {
        var fd = _elementorPendingFormData || {};
        _elementorPendingFormData = null;
        saveUserCookies(fd);
        fireTrigger('lead', fd);
      } catch(e) {}
    }

    // Method 1: MutationObserver watching for elementor-message-success
    // Catches both newly added nodes AND class/style changes on existing hidden elements
    try {
      if (typeof MutationObserver !== 'undefined') {
        new MutationObserver(function(mutations) {
          for (var m = 0; m < mutations.length; m++) {
            var mut = mutations[m];
            if (mut.type === 'childList') {
              for (var n = 0; n < mut.addedNodes.length; n++) {
                var node = mut.addedNodes[n];
                if (node.nodeType !== 1) continue;
                if ((node.classList && node.classList.contains('elementor-message-success')) ||
                    (node.querySelector && node.querySelector('.elementor-message-success'))) {
                  _fireElementorLead();
                }
              }
            }
            if (mut.type === 'attributes' && mut.target && mut.target.classList &&
                mut.target.classList.contains('elementor-message-success')) {
              _fireElementorLead();
            }
          }
        }).observe(document.body, {
          childList: true, subtree: true,
          attributes: true, attributeFilter: ['class', 'style']
        });
      }
    } catch(eMO) {}

    // Method 2: jQuery ajaxSuccess — fires for all jQuery AJAX calls
    try {
      if (typeof jQuery !== 'undefined') {
        jQuery(document).ajaxSuccess(function(event, xhr, settings) {
          try {
            var data = settings.data || '';
            var dataStr = typeof data === 'string' ? data : (data ? JSON.stringify(data) : '');
            if (dataStr.indexOf('elementor_pro_forms_send_form') !== -1) {
              var resp = xhr.responseJSON || JSON.parse(xhr.responseText);
              if (resp && resp.success) _fireElementorLead();
            }
          } catch(eJq) {}
        });
      }
    } catch(eJqSetup) {}

    // Method 3: XHR prototype intercept — fallback
    try {
      var _xhrOpen = XMLHttpRequest.prototype.open;
      var _xhrSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url) {
        this._rrUrl = typeof url === 'string' ? url : '';
        return _xhrOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function(data) {
        var xhr = this;
        var dataStr = typeof data === 'string' ? data : '';
        if ((xhr._rrUrl || '').indexOf('admin-ajax.php') !== -1 &&
            dataStr.indexOf('elementor_pro_forms_send_form') !== -1) {
          xhr.addEventListener('load', function() {
            try {
              if (xhr.status === 200) {
                var resp = JSON.parse(xhr.responseText);
                if (resp && resp.success) _fireElementorLead();
              }
            } catch(eXhr) {}
          });
        }
        return _xhrSend.apply(this, arguments);
      };
    } catch(eIntercept) {}

    // Method 4: fetch() intercept — for Elementor versions using REST API
    try {
      var _origFetch = window.fetch;
      window.fetch = function(url, options) {
        var result = _origFetch.apply(this, arguments);
        try {
          var urlStr = typeof url === 'string' ? url : '';
          var body = options && options.body ? options.body : '';
          var bodyStr = typeof body === 'string' ? body : '';
          if ((urlStr.indexOf('admin-ajax.php') !== -1 || urlStr.indexOf('wp-json') !== -1) &&
              bodyStr.indexOf('elementor_pro_forms_send_form') !== -1) {
            result.then(function(resp) {
              return resp.clone().json().then(function(data) {
                if (data && data.success) _fireElementorLead();
              });
            }).catch(function() {});
          }
        } catch(eFetch) {}
        return result;
      };
    } catch(eFetchSetup) {}
  }

  try { initForms(); } catch(e) {}

  // ============================================================
  // MODULE 6 — Geolocation (server-side via request.cf)
  // ============================================================
  // Geo é coletado automaticamente pelo Worker via request.cf
  // (country, city, region, postalCode) — sem chamada de API externa.
  try { fireTrigger('page_view', {}); } catch(e) {}

})();
