import { CardItem, Snippet } from "../types/marketplace-types";
import { processAuthors, addToSessionStorage } from "./Utils";
import { ITEMS_PER_REQUEST, BLACKLIST_URL, THEMES_URL } from "../constants";
import { RepoTopic } from "../types/marketplace-types";
import snippetsJSON from "../../resources/snippets";

// TODO: add sort type, order, etc?
// https://docs.github.com/en/github/searching-for-information-on-github/searching-on-github/searching-for-repositories#search-by-topic
// https://docs.github.com/en/rest/reference/search#search-repositories

/**
 * Query GitHub for all repos with the requested topic
 * @param tag The tag ("topic") to search for
 * @param page The query page number
 * @returns Array of search results (filtered through the blacklist)
 */
export async function getTaggedRepos(tag: RepoTopic, page = 1, BLACKLIST:string[] = [], query?: string) {
  // www is needed or it will block with "cross-origin" error.
  let url = query
    ? `https://api.github.com/search/repositories?q=${encodeURIComponent(`${query}+topic:${tag}`)}&per_page=${ITEMS_PER_REQUEST}`
    : `https://api.github.com/search/repositories?q=${encodeURIComponent(`topic:${tag}`)}&per_page=${ITEMS_PER_REQUEST}`;

  // We can test multiple pages with this URL (58 results), as well as broken iamges etc.
  // let url = `https://api.github.com/search/repositories?q=${encodeURIComponent("topic:spicetify")}`;
  if (page) url += `&page=${page}`;
  // Sorting params (not implemented for Marketplace yet)
  // if (sortConfig.by.match(/top|controversial/) && sortConfig.time) {
  //     url += `&t=${sortConfig.time}`
  const allRepos = await fetch(url).then(res => res.json()).catch(() => []);
  if (!allRepos.items) {
    Spicetify.showNotification("Too Many Requests, Cool Down.");
    return;
  }
  const filteredResults = {
    ...allRepos,
    // Include count of all items on the page, since we're filtering the blacklist below,
    // which can mess up the paging logic
    page_count: allRepos.items.length,
    items: allRepos.items.filter(item => !BLACKLIST.includes(item.html_url)),
  };

  return filteredResults;
}

// TODO: add try/catch here?
// TODO: can we add a return type here?
/**
* Get the manifest object for a repo
* @param user Owner username
* @param repo Repo name
* @param branch Default branch name (e.g. main or master)
* @returns The manifest object
*/
async function getRepoManifest(user: string, repo: string, branch: string) {
  const sessionStorageItem = window.sessionStorage.getItem(`${user}-${repo}`);
  const failedSessionStorageItems = window.sessionStorage.getItem("noManifests");
  if (sessionStorageItem) return JSON.parse(sessionStorageItem);

  const url = `https://raw.githubusercontent.com/${user}/${repo}/${branch}/manifest.json`;
  if (failedSessionStorageItems?.includes(url)) return null;

  const manifest = await fetch(url).then(res => res.json()).catch(
    () => addToSessionStorage([url], "noManifests"),
  );
  if (manifest) window.sessionStorage.setItem(`${user}-${repo}`, JSON.stringify(manifest));

  return manifest;
}

// TODO: can we add a return type here?
/**
* Fetch extensions from a repo and format data for generating cards
* @param contents_url The repo's GitHub API contents_url (e.g. "https://api.github.com/repos/theRealPadster/spicetify-hide-podcasts/contents/{+path}")
* @param branch The repo's default branch (e.g. main or master)
* @param stars The number of stars the repo has
* @returns Extension info for card (or null)
*/
export async function fetchExtensionManifest(contents_url: string, branch: string, stars: number, hideInstalled = false) {
  try {
    // TODO: use the original search full_name ("theRealPadster/spicetify-hide-podcasts") or something to get the url better?
    let manifests;
    const regex_result = contents_url.match(/https:\/\/api\.github\.com\/repos\/(?<user>.+)\/(?<repo>.+)\/contents/);
    // TODO: err handling?
    if (!regex_result || !regex_result.groups) return null;
    const { user, repo } = regex_result.groups;

    manifests = await getRepoManifest(user, repo, branch);

    // If the manifest returned is not an array, initialize it as one
    if (!Array.isArray(manifests)) manifests = [manifests];

    // Manifest is initially parsed
    const parsedManifests: CardItem[] = manifests.reduce((accum, manifest) => {
      const selectedBranch = manifest.branch || branch;
      const item = {
        manifest,
        title: manifest.name,
        subtitle: manifest.description,
        authors: processAuthors(manifest.authors, user),
        user,
        repo,
        branch: selectedBranch,

        imageURL: manifest.preview && manifest.preview.startsWith("http")
          ? manifest.preview
          : `https://raw.githubusercontent.com/${user}/${repo}/${selectedBranch}/${manifest.preview}`,
        extensionURL: manifest.main.startsWith("http")
          ? manifest.main
          : `https://raw.githubusercontent.com/${user}/${repo}/${selectedBranch}/${manifest.main}`,
        readmeURL: manifest.readme && manifest.readme.startsWith("http")
          ? manifest.readme
          : `https://raw.githubusercontent.com/${user}/${repo}/${selectedBranch}/${manifest.readme}`,
        stars,
        tags: manifest.tags,
      };

      // If manifest is valid, add it to the list
      if (manifest && manifest.name && manifest.description && manifest.main
      ) {
        // Add to list unless we're hiding installed items and it's installed
        if (!(hideInstalled
          && localStorage.getItem("marketplace:installed:" + `${user}/${repo}/${manifest.main}`))
        ) accum.push(item);
      }
      // else {
      //     console.error("Invalid manifest:", manifest);
      // }

      return accum;
    }, []);

    return parsedManifests;
  }
  catch (err) {
    // console.warn(contents_url, err);
    return null;
  }
}

// TODO: can we add a return type here?
// TODO: Update these docs
/**
* Fetch themes from a repo and format data for generating cards
* @param contents_url The repo's GitHub API contents_url (e.g. "https://api.github.com/repos/theRealPadster/spicetify-hide-podcasts/contents/{+path}")
* @param branch The repo's default branch (e.g. main or master)
* @param stars The number of stars the repo has
* @returns Extension info for card (or null)
*/
export async function buildThemeCardData(manifest: any) { // TODO: add type
  try {
    // TODO: figure this out...
    const [ user, repo, selectedBranch ] = ["spicetify", "spicetify-themes", "generated-manifest"];

    // Manifest is initially parsed
    const parsedManifest: CardItem[] = {
      manifest,
      title: manifest.name,
      subtitle: manifest.description,
      authors: processAuthors(manifest.authors, "user..."), // TODO: do we need a fallback?
      // TODO: do we need these?
      user,
      repo,
      branch: selectedBranch,
      imageURL: manifest.preview && manifest.preview.startsWith("http")
        ? manifest.preview
        : `https://raw.githubusercontent.com/${user}/${repo}/${selectedBranch}/${manifest.preview}`,
      readmeURL: manifest.readme && manifest.readme.startsWith("http")
        ? manifest.readme
        : `https://raw.githubusercontent.com/${user}/${repo}/${selectedBranch}/${manifest.readme}`,
      stars: 0, // TODO: get stars working
      tags: manifest.tags,
      // theme stuff
      cssURL: manifest.usercss.startsWith("http")
        ? manifest.usercss
        : `https://raw.githubusercontent.com/${user}/${repo}/${selectedBranch}/${manifest.usercss}`,
      // TODO: clean up indentation etc
      schemesURL: manifest.schemes
        ? (
          manifest.schemes.startsWith("http") ? manifest.schemes : `https://raw.githubusercontent.com/${user}/${repo}/${selectedBranch}/${manifest.schemes}`
        )
        : null,
      include: manifest.include,
    };
    return parsedManifest;
  }
  catch (err) {
    // console.warn(contents_url, err);
    return null;
  }
}

/**
* Fetch custom apps from a repo and format data for generating cards
* @param contents_url The repo's GitHub API contents_url (e.g. "https://api.github.com/repos/theRealPadster/spicetify-hide-podcasts/contents/{+path}")
* @param branch The repo's default branch (e.g. main or master)
* @param stars The number of stars the repo has
* @returns Extension info for card (or null)
*/
export async function fetchAppManifest(contents_url: string, branch: string, stars: number) {
  try {
    // TODO: use the original search full_name ("theRealPadster/spicetify-hide-podcasts") or something to get the url better?
    let manifests;
    const regex_result = contents_url.match(/https:\/\/api\.github\.com\/repos\/(?<user>.+)\/(?<repo>.+)\/contents/);
    // TODO: err handling?
    if (!regex_result || !regex_result.groups) return null;
    const { user, repo } = regex_result.groups;

    manifests = await getRepoManifest(user, repo, branch);

    // If the manifest returned is not an array, initialize it as one
    if (!Array.isArray(manifests)) manifests = [manifests];

    // Manifest is initially parsed
    const parsedManifests: CardItem[] = manifests.reduce((accum, manifest) => {
      const selectedBranch = manifest.branch || branch;
      // TODO: tweak saved items
      const item = {
        manifest,
        title: manifest.name,
        subtitle: manifest.description,
        authors: processAuthors(manifest.authors, user),
        user,
        repo,
        branch: selectedBranch,

        imageURL: manifest.preview && manifest.preview.startsWith("http")
          ? manifest.preview
          : `https://raw.githubusercontent.com/${user}/${repo}/${selectedBranch}/${manifest.preview}`,
        // Custom Apps don't have an entry point; they're just listed so they can link out from the card
        // extensionURL: manifest.main.startsWith("http")
        //   ? manifest.main
        //   : `https://raw.githubusercontent.com/${user}/${repo}/${selectedBranch}/${manifest.main}`,
        readmeURL: manifest.readme && manifest.readme.startsWith("http")
          ? manifest.readme
          : `https://raw.githubusercontent.com/${user}/${repo}/${selectedBranch}/${manifest.readme}`,
        stars,
        tags: manifest.tags,
      };

      // If manifest is valid, add it to the list
      if (manifest && manifest.name && manifest.description) {
        accum.push(item);
      }
      // else {
      //     console.error("Invalid manifest:", manifest);
      // }

      return accum;
    }, []);

    return parsedManifests;
  }
  catch (err) {
    // console.warn(contents_url, err);
    return null;
  }
}

export const getThemesMonoManifest = async () => {
  const manifest = await fetch(THEMES_URL).then(res => res.json()).catch(() => null);
  return manifest;
};

/**
* It fetches the blacklist.json file from the GitHub repository and returns the array of blocked repos.
* @returns String array of blacklisted repos
*/
export const getBlacklist = async () => {
  const json = await fetch(BLACKLIST_URL).then(res => res.json()).catch(() => ({}));
  return json.repos as string[] | undefined;
};

/**
* It fetches the snippets.json file from the Github repository and returns it as a JSON object.
* @returns Array of snippets
*/
export const fetchCssSnippets = async () => {
  const snippets = snippetsJSON.reduce<Snippet[]>((accum, snippet) => {
    const snip = { ...snippet } as Snippet;

    // Because the card component looks for an imageURL prop
    if (snip.preview) {
      snip.imageURL = snip.preview.startsWith("http")
        ? snip.preview
        : `https://raw.githubusercontent.com/spicetify/spicetify-marketplace/main/${snip.preview}`;
      delete snip.preview;
    }

    accum.push(snip);
    return accum;
  }, []);
  return snippets;
};
