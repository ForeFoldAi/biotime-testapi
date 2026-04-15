const { fetchList, RESOURCE_ENDPOINTS } = require("../services/listService");

async function getResourceList(req, res, next) {
  try {
    const resource = String(req.params.resource || "").toLowerCase();
    const data = await fetchList(resource, req.query);
    res.json({
      resource,
      endpoint: RESOURCE_ENDPOINTS[resource],
      query: req.query,
      ...data,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getResourceList,
};
