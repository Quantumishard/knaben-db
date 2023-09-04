const parseTorrent = require("parse-torrent");
const express = require("express");
const app = express();
const fetch = require("node-fetch");
const torrentStream = require("torrent-stream");

const bodyParser = require("body-parser");

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
        connections: 10, // Limit the number of connections/streams
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
      engine.destroy();
    } catch (error) {
      // Handle any errors here
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
  try {
    const controller = new AbortController();
    // 5-second timeout:
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 301 || response.status === 302) {
      const locationURL = new URL(
        response.headers.get("location"),
        response.url
      );
      if (locationURL.href.startsWith("http")) {
        return await isRedirect(locationURL);
      } else {
        return locationURL.href;
      }
    } else if (response.status >= 200 && response.status < 300) {
      return response.url;
    } else {
      return null;
    }
  } catch (error) {
    // Handle any errors here
    console.error("Error while following redirection:", error);
    return null;
  }
};

const streamFromMagnet = (tor, uri, type, s, e) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Follow redirection in case the URI is not directly accessible
      const realUrl = uri?.startsWith("magnet:?") ? uri : await isRedirect(uri);

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
    } catch (error) {
      console.error("Error while streaming from magnet:", error);
      resolve(null);
    }
  });
};

let stream_results = [];
let torrent_results = [];

const host = "http:/129.153.72.60:9117";
const apiKey = "k7lsbawbs4aq8t1s56c58jm091gm7mk7";

let fetchTorrent = async (query) => {
  let url = `${host}/api/v2.0/indexers/all/results?apikey=${apiKey}&Query=${query}&Category[]=2000&Category[]=5000&Category[]=8000&Category[]=100001&Category[]=100002&Category[]=100003&Tracker[]=filelisting&Tracker[]=bitsearch`;

  try {
    const response = await fetch(url, {
      headers: {
        accept: "*/*",
        "accept-language": "en-US,en;q=0.9",
        "x-requested-with": "XMLHttpRequest",
        cookie:
          "Jackett=CfDJ8AG_XUDhxS5AsRKz0FldsDJIHUJANrfynyi54VzmYuhr5Ha5Uaww2hSQytMR8fFWjPvDH2lKCzaQhRYI9RuK613PZxJWz2tgHqg1wUAcPTMfi8b_8rm1Igw1-sZB_MnimHHK7ZSP7HfkWicMDaJ4bFGZwUf0xJOwcgjrwcUcFzzsVSTALt97-ibhc7PUn97v5AICX2_jsd6khO8TZosaPFt0cXNgNofimAkr5l6yMUjShg7R3TpVtJ1KxD8_0_OyBjR1mwtcxofJam2aZeFqVRxluD5hnzdyxOWrMRLSGzMPMKiaPXNCsxWy_yQhZhE66U_bVFadrsEeQqqaWb3LIFA",
      },
      referrerPolicy: "no-referrer",
      method: "GET",
    });

    if (!response.ok) {
      console.error("Error fetching torrents. Status:", response.status);
      return [];
    }

    const results = await response.json();
    console.log({ Initial: results["Results"].length });

    if (results["Results"].length !== 0) {
      return results["Results"].map((result) => ({
        Tracker: result["Tracker"],
        Category: result["CategoryDesc"],
        Title: result["Title"],
        Seeders: result["Seeders"],
        Peers: result["Peers"],
        Link: result["Link"],
        MagnetUri: result["MagnetUri"],
      }));
    } else {
      return [];
    }
  } catch (error) {
    // Handle any errors here
    console.error("Error fetching torrents:", error);
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
    id: "mikmc.od.org+++",
    version: "3.0.0",
    name: "HYJackett",
    description: "Movie & TV Streams from Jackett",
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

  query = meta?.name;

  if (media === "movie") {
    query += " " + meta?.year;
  } else if (media === "series") {
    query += " S" + (s ?? "1").padStart(2, "0");
  }
  query = encodeURIComponent(query);

  // Fetch torrents based on the query
  const torrentResults = await fetchTorrent(query);

  // Prepare an array to hold the streaming results
  const streamResults = [];

  for (const torrent of torrentResults) {
    if ((torrent["MagnetUri"] !== "" || torrent["Link"] !== "") && torrent["Peers"] > 1) {
      const streamResult = await streamFromMagnet(
        torrent,
        torrent["MagnetUri"] || torrent["Link"],
        media,
        s,
        e
      );
      if (streamResult) {
        streamResults.push(streamResult);
      }
    }
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Content-Type", "application/json");

  return res.send({ streams: streamResults });
});

// Rest of the code...

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("The server is working on port " + port);
});
