const parseTorrent = require("parse-torrent");
const express = require("express");
const app = express();
const fetch = require("node-fetch");
const torrentStream = require("torrent-stream");
const bodyParser = require("body-parser");
const pLimit = require('p-limit');
const http = require("http");
const limit = pLimit(10);

function getSize(size) {
  const gb = 1024 * 1024 * 1024;
  const mb = 1024 * 1024;

  return (
    "💾 " +
    (size / gb > 1 ? `${(size / gb).toFixed(2)} GB` : `${(size / mb).toFixed(2)} MB`)
  );
}

function getQuality(name) {
  name = name.toLowerCase();

  if (["2160", "4k", "uhd"].some((x) => name.includes(x))) return "🌟4k";
  if (["1080", "fhd"].some((x) => name.includes(x))) return " 🎥FHD";
  if (["720", "hd"].some((x) => name.includes(x))) return "📺HD";
  if (["480p", "380p", "sd"].some((x) => name.includes(x))) return "📱SD";
  return "";
}

const toStream = async (parsed, uri, tor, type, s, e) => {
  const infoHash = parsed.infoHash.toLowerCase();
  let title = tor.extraTag || parsed.name;
  let index = 0;

if (!parsed.files && uri.startsWith("magnet")) {
  try {
    const engine = torrentStream("magnet:" + uri, {
      connections: 3, // Limit the number of connections/streams
    });

    const res = await new Promise((resolve, reject) => {
      engine.on("ready", function () {
        resolve(engine.files);
      });

      setTimeout(() => {
        resolve([]);
      }, 5000); // Timeout if the server is too slow
    });

    parsed.files = res;
    
    // Properly close the torrent engine
    engine.on("idle", () => {
      engine.destroy((err) => {
        if (err) {
          console.error("Error destroying engine:", err);
        }
      });
    });
  } catch (error) {
    console.error("Error fetching torrent data:", error);
  }
}

  if (type === "series") {
    index = (parsed.files || []).findIndex((element) => {
      return (
        element["name"]?.toLowerCase()?.includes(`s0${s}`) &&
        element["name"]?.toLowerCase()?.includes(`e0${e}`) &&
        [".mkv", ".mp4", ".avi", ".flv"].some((ext) =>
          element["name"]?.toLowerCase()?.includes(ext)
        )
      );
    });

    if (index === -1) {
      return null;
    }
    title += index === -1 ? "" : `\n${parsed.files[index]["name"]}`;
  }

  title += "\n" + getQuality(title);

  const subtitle = "S:" + tor["Seeders"] + " /P:" + tor["Peers"];
  title += ` | ${
    index === -1
      ? `${getSize(parsed.length || 0)}`
      : `${getSize((parsed.files && parsed.files[index]?.length) || 0)}`
  } | ${subtitle} `;

  return {
    name: tor["Tracker"],
    type,
    infoHash,
    fileIdx: index === -1 ? 0 : index,
    sources: (parsed.announce || []).map((x) => {
      return "tracker:" + x;
    }).concat(["dht:" + infoHash]),
    title,
    behaviorHints: {
      bingeGroup: `Jackett-Addon|${infoHash}`,
      notWebReady: true,
    },
  };
};

const isRedirect = async (url) => {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error("Request timeout"));
    }, 5000); // 5-second timeout

    const urlObject = new URL(url);
    
    // Ensure the protocol is either "http" or "https"
    if (urlObject.protocol !== "http:" && urlObject.protocol !== "https:") {
      reject(new Error("Invalid protocol. Expected 'http:' or 'https:'"));
    }

    const requestOptions = {
      protocol: urlObject.protocol,
      hostname: urlObject.hostname,
      port: urlObject.port || (urlObject.protocol === 'http:' ? 80 : 443), // Use 80 for HTTP and 443 for HTTPS
      path: urlObject.pathname + urlObject.search,
      method: "HEAD",
    };

    const request = http.request(requestOptions, (response) => {
      clearTimeout(timeoutId);
      if (response.statusCode === 301 || response.statusCode === 302) {
        const locationURL = new URL(response.headers.location);
        if (locationURL.href.startsWith("http") || locationURL.href.startsWith("https")) {
          resolve(isRedirect(locationURL.href));
        } else {
          resolve(locationURL.href);
        }
      } else if (response.statusCode >= 200 && response.statusCode < 300) {
        resolve(url);
      } else {
        resolve(null);
      }
    });

    request.on("error", (error) => {
      clearTimeout(timeoutId);
      console.error("Error while following redirection:", error);
      resolve(null);
    });

    request.end();
  });
};


const streamFromMagnet = async (tor, uri, type, s, e, retries = 3) => {
  return new Promise(async (resolve, reject) => {
    let retryCount = 0;

    const attemptStream = async () => {
      try {
        if (uri.startsWith("magnet:?")) {
          const parsedTorrent = parseTorrent(uri);
          resolve(await toStream(parsedTorrent, uri, tor, type, s, e));
        } else {
          // Follow redirection in case the URI is not directly accessible
          const realUrl = await isRedirect(uri);

          if (!realUrl) {
            console.log("No real URL found.");
            resolve(null);
            return;
          }

          if (realUrl.startsWith("magnet:?")) {
            const parsedTorrent = parseTorrent(realUrl);
            resolve(await toStream(parsedTorrent, realUrl, tor, type, s, e));
          } else if (realUrl.startsWith("http")) {
            parseTorrent.remote(realUrl, (err, parsed) => {
              if (!err) {
                resolve(toStream(parsed, realUrl, tor, type, s, e));
              } else {
                console.error("Error parsing HTTP:", err);
                resolve(null);
              }
            });
          } else {
            console.error("No HTTP nor magnet URI found.");
            resolve(null);
          }
        }
      } catch (error) {
        console.error("Error while streaming from magnet:", error);
        retryCount++;
        if (retryCount < retries) {
          console.log("Retrying...");
          attemptStream();
        } else {
          console.error("Exceeded retry attempts. Giving up.");
          resolve(null);
        }
      }
    };

    attemptStream();
  });
};


let stream_results = [];
let torrent_results = [];

const host1 = {
  hostUrl: "http://198.244.178.163:9117",
  apiKey: "21ctcfyphhtsbvrbnkwjod3u2khw0s5b",
};

const host2 = {
  hostUrl: "http://100.12.26.164:9117",
  apiKey: "b3f8f3fb4rtt4vcsml7cz82dtkjbj3df",
};

const fetchTorrentFromHost1 = async (query) => {
  const { hostUrl, apiKey } = host1;
  const url = `${hostUrl}/api/v2.0/indexers/all/results?apikey=${apiKey}&Query=${query}&Category[]=2000&Category[]=5000&Category[]=8000&Category[]=10001&Category[]=10002&Category[]=10003&Tracker[]=filelisting&Tracker[]=bitsearch`;

  try {
    const response = await fetch(url, {
      headers: {
        accept: "*/*",
        "accept-language": "en-US,en;q=0.9",
        "x-requested-with": "XMLHttpRequest",
        cookie:
          "Jackett=CfDJ8JGMKzAOIg1GpbGxjar2TujvQ1tVmIta0XThcBG4V_j32mQnx6z3GDTiqYsDLv0jLvfan6JOfx_Mr61hId8KLu389GzmDM6RDqq6yN7K3-ucA7FSricYvgWGmNnVq5xL7cdQfNVIvv78fhRG0Z7lw_Yjz47ZPY9ChVi2ppvE9NFr8dMUg_-fto8XEFEy29ZI6bsxX4KWYoEP-S_zUhhymLf54VJSQKCAvo7d0ZLzWh9p_08kEGaGxyTA8tZYhbolyjKEBoGno80BawzJq2jog8ThKhmtN45rAQdb1CrOkT9dl0S8e0M0_ivZJj-_YeLWOtRn9ygYhiAFhZkIRTJXXbw",
      },
      referrerPolicy: "no-referrer",
      method: "GET",
    });

    if (!response.ok) {
      console.error("Error fetching torrents from host 1. Status:", response.status);
      return [];
    }

    const results = await response.json();
    console.log({ Host1: results["Results"].length });

    if (results["Results"].length !== 0) {
      return results["Results"].map((result) => ({
        Tracker: result["Tracker"],
        Category: result["CategoryDesc"],
        Title: result["Title"],
        Seeders: result["Seeders"],
        Peers: result["Peers"],
        Link: result["Link"],
        MagnetUri: result["MagnetUri"],
        Host: "Host1", // Add a new property indicating the host
      }));
    } else {
      return [];
    }
  } catch (error) {
    console.error("Error fetching torrents from host 1:", error);
    return [];
  }
};

  const fetchTorrentFromHost2 = async (query) => {
  const { hostUrl, apiKey } = host2;
  const url = `${hostUrl}/api/v2.0/indexers/all/results?apikey=${apiKey}&Query=${query}&Category%5B%5D=2000&Category%5B%5D=2010&Category%5B%5D=2020&Category%5B%5D=2030&Category%5B%5D=2040&Category%5B%5D=2045&Category%5B%5D=2070&Category%5B%5D=5000&Category%5B%5D=5020&Category%5B%5D=5030&Category%5B%5D=5040&Category%5B%5D=5045&Category%5B%5D=5050&Category%5B%5D=5060&Category%5B%5D=5070&Category%5B%5D=5080&Category%5B%5D=2100000&Category%5B%5D=2101000&Category%5B%5D=2102000&Category%5B%5D=2103000&Category%5B%5D=2104000&Category%5B%5D=2105000&Category%5B%5D=2107000&Category%5B%5D=2108000&Category%5B%5D=3100000&Category%5B%5D=3101000&Category%5B%5D=3102000&Category%5B%5D=3103000&Category%5B%5D=3104000&Category%5B%5D=3105000&Category%5B%5D=3108000&Tracker%5B%5D=knaben`;

  try {
    const response = await fetch(url, {
      headers: {
        accept: "*/*",
        "accept-language": "en-US,en;q=0.9",
        "x-requested-with": "XMLHttpRequest",
        cookie:
          "Jackett=CfDJ8JGMKzAOIg1GpbGxjar2TujvQ1tVmIta0XThcBG4V_j32mQnx6z3GDTiqYsDLv0jLvfan6JOfx_Mr61hId8KLu389GzmDM6RDqq6yN7K3-ucA7FSricYvgWGmNnVq5xL7cdQfNVIvv78fhRG0Z7lw_Yjz47ZPY9ChVi2ppvE9NFr8dMUg_-fto8XEFEy29ZI6bsxX4KWYoEP-S_zUhhymLf54VJSQKCAvo7d0ZLzWh9p_08kEGaGxyTA8tZYhbolyjKEBoGno80BawzJq2jog8ThKhmtN45rAQdb1CrOkT9dl0S8e0M0_ivZJj-_YeLWOtRn9ygYhiAFhZkIRTJXXbw",
      },
      referrerPolicy: "no-referrer",
      method: "GET",
    });

    if (!response.ok) {
      console.error("Error fetching torrents from host 2. Status:", response.status);
      return [];
    }

    const results = await response.json();
    console.log({ Host2: results["Results"].length });

    if (results["Results"].length !== 0) {
      return results["Results"].map((result) => ({
        Tracker: result["Tracker"],
        Category: result["CategoryDesc"],
        Title: result["Title"],
        Seeders: result["Seeders"],
        Peers: result["Peers"],
        Link: result["Link"],
        MagnetUri: result["MagnetUri"],
        Host: "Host2", // Add a new property indicating the host
      }));
    } else {
      return [];
    }
  } catch (error) {
    console.error("Error fetching torrents from host 2:", error);
    return [];
  }
};

function getMeta(id, type) {
  var [tt, s, e] = id.split(":");

  return fetch(`https://v2.sg.media-imdb.com/suggestion/t/${tt}.json`)
    .then((res) => res.json())
    .then((json) => json.d[0])
    .then(({ l, y }) => ({ name: l, year: y }))
    .catch((err) =>
      fetch(`https://v3-cinemeta.strem.io/meta/${type}/${tt}.json`)
        .then((res) => res.json())
        .then((json) => json.meta)
    );
}

app.get("/manifest.json", (req, res) => {
  const manifest = {
    id: "hy.torr.org",
    version: "1.0.1",
    name: "HYJackett",
    description: "Movie & TV Torrents from Jackett",
    logo: "https://raw.githubusercontent.com/mikmc55/hyackett/main/hyjackett.jpg",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [],
  };

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Content-Type", "application/json");
  return res.send(manifest);
});

app.get("/stream/:type/:id", async (req, res) => {
  const media = req.params.type;
  let id = req.params.id;
  id = id.replace(".json", "");

  let [tt, s, e] = id.split(":");
  let query = "";
  let meta = await getMeta(tt, media);

  console.log({ meta: id });
  console.log({ meta });
  query = meta?.name;

  if (media === "movie") {
    query += " " + meta?.year;
  } else if (media === "series") {
    query += " S" + (s ?? "1").padStart(2, "0");
  }
  query = encodeURIComponent(query);

  // Fetch torrents from both hosts
  const result1 = await limit(() => fetchTorrentFromHost1(query));
  const result2 = await limit(() => fetchTorrentFromHost2(query));

  // Combine results from both hosts
  const combinedResults = result1.concat(result2);

  // Process and filter the combined results
  const uniqueResults = [];
  const seenTorrents = new Set();

  for (const torrent of combinedResults) {
    const torrentKey = `${torrent.Tracker}-${torrent.Title}`;
    if (
      !seenTorrents.has(torrentKey) &&
      (torrent["MagnetUri"] !== "" || torrent["Link"] !== "") &&
      torrent["Peers"] > 0
    ) {
      seenTorrents.add(torrentKey);
      uniqueResults.push(torrent);
    }
  }

  // Use the global stream_results variable, no need to re-declare it here
  stream_results = await Promise.all(
    uniqueResults.map((torrent) => {
      return limit(() => streamFromMagnet(
        torrent,
        torrent["MagnetUri"] || torrent["Link"],
        media,
        s,
        e
      ));
    })
  );

  stream_results = stream_results.filter((e) => !!e);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Content-Type", "application/json");

  // Send the response with the stream_results
  res.send({ streams: stream_results });

  console.log({ check: "check" });

  console.log({ Final: stream_results.length });
});


const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("The server is working on port " + port);
});
