export default defineEventHandler((event) => {
  setResponseHeader(event, 'cache-control', 'no-store')

  return {
    status: 'ok',
    component: 'control-plane',
  }
})
