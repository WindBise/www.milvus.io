const path = require("path");
const fs = require("fs");
const ReadVersionJson = require("./walkFile");
const locales = require("./src/constants/locales");
const DOC_LANG_FOLDERS = ["/en/", "/zh-CN/"];

// the version is same for different lang, so we only need one
const DOC_ROOT = "src/pages/docs/versions";
const versionInfo = ReadVersionJson(DOC_ROOT);

exports.onCreatePage = ({ page, actions }) => {
  const { createPage, deletePage } = actions;
  return new Promise(resolve => {
    deletePage(page);
    Object.keys(locales).map(lang => {
      const localizedPath = locales[lang].default
        ? page.path
        : locales[lang].path + page.path;
      return createPage({
        ...page,
        path: localizedPath,
        context: {
          locale: lang
        }
      });
    });
    resolve();
  });
};

exports.createPages = ({ actions, graphql }) => {
  const { createPage } = actions;

  const docTemplate = path.resolve(`src/templates/docTemplate.js`);

  // isMenu outLink can be add when need to use
  return graphql(`
    {
      allMarkdownRemark(
        limit: 1000
        filter: { fileAbsolutePath: { regex: "/(?:site|blog)/" } }
      ) {
        edges {
          node {
            headings {
              value
              depth
            }
            frontmatter {
              id
            }
            fileAbsolutePath
          }
        }
      }
      allFile(filter: { relativeDirectory: { regex: "/(?:menuStructure)/" } }) {
        edges {
          node {
            absolutePath
            childMenuStructureJson {
              menuList {
                id
                title
                lang
                label1
                label2
                label3
                order
                isMenu
                outLink
              }
            }
          }
        }
      }
    }
  `).then(result => {
    if (result.errors) {
      return Promise.reject(result.errors);
    }
    const findVersion = str => {
      const regx = /versions\/([v\d\.]*)/;
      const match = str.match(regx);
      return match ? match[1] : "";
    };

    // get all menuStructures
    const allMenus = result.data.allFile.edges.map(
      ({ node: { absolutePath, childMenuStructureJson } }) => {
        let lang = absolutePath.includes("/en/") ? "en" : "cn";
        const isBlog = absolutePath.includes("blog");
        const version = findVersion(absolutePath) || "master";
        return {
          lang,
          version,
          isBlog,
          menuList: childMenuStructureJson.menuList,
          absolutePath
        };
      }
    );

    // filter useless md file blog has't version
    const legalMd = result.data.allMarkdownRemark.edges.filter(
      ({ node: { fileAbsolutePath, frontmatter } }) =>
        (!!findVersion(fileAbsolutePath) ||
          fileAbsolutePath.includes("/blog/zh-CN") ||
          fileAbsolutePath.includes("/docs/versions/master/")) &&
        frontmatter.id
    );
    const generatePath = (id, lang, version, isBlog, needLocal = true) => {
      if (isBlog) {
        if (!needLocal) return `/blogs/${id}`;
        return lang === defaultLang ? `/blogs/${id}` : `${lang}/blogs/${id}`;
      }
      const findMenu = allMenus.find(
        v => v.lang === lang && v.version === version
      );

      const menuList = findMenu ? findMenu.menuList : [];
      const doc = menuList.find(v => v.id === id);
      const { label1, label2, label3 } = doc || {};
      let localizedPath = "";
      if (version && version !== "master") {
        localizedPath =
          lang === defaultLang
            ? `/docs/${version}/`
            : `${lang}/docs/${version}/`;
      } else {
        // for master branch version -> false
        localizedPath = lang === defaultLang ? `/docs/` : `${lang}/docs/`;
      }

      let parentPath = "";
      if (label1) {
        parentPath += `${label1}/`;
      }
      if (label2) {
        parentPath += `${label2}/`;
      }
      if (label3) {
        parentPath += `${label3}/`;
      }
      return needLocal
        ? `${localizedPath}${parentPath}${id}`
        : `${parentPath}${id}`;
    };

    const defaultLang = Object.keys(locales).find(
      lang => locales[lang].default
    );

    // -----  for global search begin -----
    const flatten = arr =>
      arr.map(({ node: { frontmatter, fileAbsolutePath, headings } }) => {
        const fileLang = DOC_LANG_FOLDERS.reduce((pre, cur) => {
          if (fileAbsolutePath.includes(cur)) {
            pre = cur === "/en/" ? "en" : "cn";
          }
          return pre;
        }, "");

        const version = findVersion(fileAbsolutePath) || "master";
        const headingVals = headings.map(v => v.value);
        const isBlog = fileAbsolutePath.includes("blog");
        return {
          ...frontmatter,
          fileLang,
          version,
          path: generatePath(frontmatter.id, fileLang, version, isBlog, false),
          // the value we need compare with search query
          values: [...headingVals, frontmatter.id]
        };
      });
    const fileData = flatten(legalMd);
    fs.writeFile(
      `${__dirname}/src/search.json`,
      JSON.stringify(fileData),
      err => {
        if (err) throw err;
        console.log("It's saved!");
      }
    );
    // -----  for global search end -----

    // get all version
    const versions = new Set();
    legalMd.forEach(({ node }) => {
      const fileAbsolutePath = node.fileAbsolutePath;
      const version = findVersion(fileAbsolutePath);

      // released: no -> not show , yes -> show
      if (versionInfo[version] && versionInfo[version].released === "yes") {
        versions.add(version);
      }
    });

    return legalMd.forEach(({ node }) => {
      const fileAbsolutePath = node.fileAbsolutePath;
      const fileId = node.frontmatter.id;
      let version = findVersion(fileAbsolutePath);

      const fileLang = DOC_LANG_FOLDERS.reduce((pre, cur) => {
        if (fileAbsolutePath.includes(cur)) {
          pre = cur === "/en/" ? "en" : "cn";
        }
        return pre;
      }, "");
      const isBlog = fileAbsolutePath.includes("blog");
      const localizedPath = generatePath(fileId, fileLang, version, isBlog);
      // console.log(isBlog, localizedPath)
      // the newest doc version is master so we need to make route without version.
      // for easy link to the newest doc
      if (!version && fileAbsolutePath.includes("master")) {
        const masterPath = generatePath(
          fileId,
          fileLang,
          isBlog ? false : "master",
          isBlog
        );
        return createPage({
          path: masterPath,
          component: docTemplate,
          context: {
            locale: fileLang,
            version: isBlog ? "master" : versionInfo.master.version, // get master version
            versions: Array.from(versions),
            old: fileId,
            headings: node.headings.filter(v => v.depth < 4 && v.depth >= 1),
            fileAbsolutePath,
            isBlog,
            editPath: generatePath(fileId, fileLang, false, isBlog, false),
            allMenus
          } // additional data can be passed via context
        });
      }
      //  normal pages
      return createPage({
        path: localizedPath,
        component: docTemplate,
        context: {
          locale: fileLang,
          version,
          versions: Array.from(versions),
          old: fileId,
          headings: node.headings.filter(v => v.depth < 4 && v.depth >= 1),
          fileAbsolutePath,
          isBlog,
          editPath: generatePath(fileId, fileLang, version, isBlog, false),
          allMenus
        } // additional data can be passed via context
      });
    });
  });
};
